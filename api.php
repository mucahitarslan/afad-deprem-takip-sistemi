<?php
declare(strict_types=1);

// api.php — Güvenli AFAD API proxy'si (PHP 7.4+)
//
// Özellikler:
// - Parametre whitelist + doğrulama
// - IP bazlı rate limiting
// - Sunucu tarafı ortak response cache
// - AFAD timeout / hata yönetimi
// - Redirect kapalı
// - Yalnızca GET

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');

const AFAD_API_URL =
    'https://servisnet.afad.gov.tr/apigateway/deprem/apiv2/event/filter';

const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

const CACHE_TTL_LIVE_SECONDS = 45;
const CACHE_TTL_HISTORICAL_SECONDS = 3600;
const CACHE_TTL_EVENT_SECONDS = 3600;

function jsonError(int $status, string $message): void
{
    http_response_code($status);

    echo json_encode(
        ['error' => $message],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    exit;
}

function storageDirectory(): string
{
    $directory =
        rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR
        . 'afad-deprem-takip';

    if (!is_dir($directory)) {
        @mkdir($directory, 0700, true);
    }

    if (!is_dir($directory) || !is_writable($directory)) {
        return '';
    }

    return $directory;
}

function safeClientIp(): string
{
    // X-Forwarded-For bilerek güvenilmiyor.
    // Reverse proxy kullanıyorsanız gerçek IP'yi web sunucusu seviyesinde
    // REMOTE_ADDR'a güvenli biçimde aktarmalısınız.
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

    return is_string($ip) && $ip !== ''
        ? $ip
        : 'unknown';
}

function applyRateLimit(): void
{
    $directory = storageDirectory();

    // Geçici dizin yazılamıyorsa uygulamayı tamamen bozmak yerine
    // rate limit katmanını atla.
    if ($directory === '') {
        return;
    }

    $key = hash('sha256', safeClientIp());
    $path =
        $directory
        . DIRECTORY_SEPARATOR
        . 'rate-'
        . $key
        . '.json';

    $handle = @fopen($path, 'c+');

    if ($handle === false) {
        return;
    }

    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        return;
    }

    rewind($handle);
    $raw = stream_get_contents($handle);
    $decoded = is_string($raw) && $raw !== ''
        ? json_decode($raw, true)
        : [];

    $timestamps = is_array($decoded) ? $decoded : [];
    $now = time();
    $cutoff = $now - RATE_LIMIT_WINDOW_SECONDS;

    $timestamps = array_values(
        array_filter(
            $timestamps,
            static function ($timestamp) use ($cutoff): bool {
                return is_int($timestamp)
                    && $timestamp > $cutoff;
            }
        )
    );

    if (count($timestamps) >= RATE_LIMIT_MAX_REQUESTS) {
        $oldest = min($timestamps);
        $retryAfter = max(
            1,
            RATE_LIMIT_WINDOW_SECONDS - ($now - $oldest)
        );

        flock($handle, LOCK_UN);
        fclose($handle);

        header('Retry-After: ' . $retryAfter);

        jsonError(
            429,
            'Çok fazla istek gönderildi. Lütfen kısa süre sonra tekrar deneyin.'
        );
    }

    $timestamps[] = $now;

    rewind($handle);
    ftruncate($handle, 0);
    fwrite(
        $handle,
        json_encode($timestamps, JSON_UNESCAPED_SLASHES)
    );
    fflush($handle);

    flock($handle, LOCK_UN);
    fclose($handle);
}

function isValidDateTime(string $value): bool
{
    $date = DateTimeImmutable::createFromFormat(
        '!Y-m-d\TH:i:s',
        $value
    );

    return $date !== false
        && $date->format('Y-m-d\TH:i:s') === $value;
}

function validateNumber(
    string $name,
    string $value,
    float $min,
    float $max
): void {
    if (!is_numeric($value)) {
        jsonError(400, "{$name} sayısal olmalıdır.");
    }

    $number = (float) $value;

    if (!is_finite($number) || $number < $min || $number > $max) {
        jsonError(
            400,
            "{$name} {$min} ile {$max} arasında olmalıdır."
        );
    }
}

function cacheTtl(array $params): int
{
    if (isset($params['eventid'])) {
        return CACHE_TTL_EVENT_SECONDS;
    }

    if (!isset($params['end'])) {
        return CACHE_TTL_LIVE_SECONDS;
    }

    try {
        $end = new DateTimeImmutable(
            $params['end'],
            new DateTimeZone('Europe/Istanbul')
        );

        $now = new DateTimeImmutable(
            'now',
            new DateTimeZone('Europe/Istanbul')
        );

        if ($end < $now->modify('-1 hour')) {
            return CACHE_TTL_HISTORICAL_SECONDS;
        }
    } catch (Throwable $error) {
        return CACHE_TTL_LIVE_SECONDS;
    }

    return CACHE_TTL_LIVE_SECONDS;
}

function cachePath(array $params): string
{
    $directory = storageDirectory();

    if ($directory === '') {
        return '';
    }

    ksort($params);

    $key = hash(
        'sha256',
        http_build_query(
            $params,
            '',
            '&',
            PHP_QUERY_RFC3986
        )
    );

    return
        $directory
        . DIRECTORY_SEPARATOR
        . 'cache-'
        . $key
        . '.json';
}

function readServerCache(array $params): ?string
{
    $path = cachePath($params);

    if ($path === '' || !is_file($path)) {
        return null;
    }

    $modified = @filemtime($path);

    if ($modified === false) {
        return null;
    }

    $ttl = cacheTtl($params);

    if (time() - $modified > $ttl) {
        @unlink($path);
        return null;
    }

    $data = @file_get_contents($path);

    if (!is_string($data) || $data === '') {
        return null;
    }

    json_decode($data, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        @unlink($path);
        return null;
    }

    header('X-Proxy-Cache: HIT');

    return $data;
}

function writeServerCache(array $params, string $data): void
{
    $path = cachePath($params);

    if ($path === '') {
        return;
    }

    $tempPath =
        $path
        . '.'
        . getmypid()
        . '.tmp';

    if (@file_put_contents($tempPath, $data, LOCK_EX) === false) {
        return;
    }

    @chmod($tempPath, 0600);

    if (!@rename($tempPath, $path)) {
        @unlink($tempPath);
    }
}

function maybeCleanupStorage(): void
{
    // Her istekte directory taraması yapmamak için yaklaşık %1 olasılıkla çalışır.
    try {
        if (random_int(1, 100) !== 1) {
            return;
        }
    } catch (Throwable $error) {
        return;
    }

    $directory = storageDirectory();

    if ($directory === '') {
        return;
    }

    $files = @glob($directory . DIRECTORY_SEPARATOR . '*.json');

    if (!is_array($files)) {
        return;
    }

    $cutoff = time() - 86400;

    foreach ($files as $file) {
        $modified = @filemtime($file);

        if ($modified !== false && $modified < $cutoff) {
            @unlink($file);
        }
    }
}

function fetchWithCurl(string $url): array
{
    $curl = curl_init($url);

    if ($curl === false) {
        return [0, false, 'cURL başlatılamadı.'];
    }

    curl_setopt_array(
        $curl,
        [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'User-Agent: DepremTakip/3.0',
            ],
        ]
    );

    $data = curl_exec($curl);
    $status = (int) curl_getinfo(
        $curl,
        CURLINFO_RESPONSE_CODE
    );
    $errorNumber = curl_errno($curl);
    $error = curl_error($curl);

    curl_close($curl);

    if ($data === false) {
        return [
            $errorNumber === CURLE_OPERATION_TIMEDOUT
                ? 504
                : 502,
            false,
            $error,
        ];
    }

    return [$status, $data, ''];
}

function fetchWithStreams(string $url): array
{
    if (
        !filter_var(
            ini_get('allow_url_fopen'),
            FILTER_VALIDATE_BOOLEAN
        )
    ) {
        return [
            0,
            false,
            'Sunucuda cURL ve allow_url_fopen kullanılamıyor.',
        ];
    }

    $context = stream_context_create(
        [
            'http' => [
                'method' => 'GET',
                'header' =>
                    "User-Agent: DepremTakip/3.0\r\n"
                    . "Accept: application/json\r\n",
                'timeout' => 15,
                'ignore_errors' => true,
            ],
        ]
    );

    $data = @file_get_contents(
        $url,
        false,
        $context
    );

    $responseHeaders =
        function_exists('http_get_last_response_headers')
            ? http_get_last_response_headers()
            : ($http_response_header ?? []);

    $status = 0;

    if (
        isset($responseHeaders[0])
        && preg_match(
            '/\s(\d{3})\s/',
            $responseHeaders[0],
            $match
        )
    ) {
        $status = (int) $match[1];
    }

    return [
        $status,
        $data,
        $data === false
            ? 'Akış isteği başarısız oldu.'
            : '',
    ];
}

// ─── Request başlangıcı ───────────────────────────────────

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    jsonError(405, 'Yalnızca GET istekleri desteklenir.');
}

applyRateLimit();
maybeCleanupStorage();

$allowedParams = [
    'start',
    'end',
    'minmag',
    'maxmag',
    'magtype',
    'mindepth',
    'maxdepth',
    'minlat',
    'maxlat',
    'minlon',
    'maxlon',
    'lat',
    'lon',
    'minrad',
    'maxrad',
    'limit',
    'orderby',
    'eventid',
    'format',
];

foreach ($_GET as $key => $value) {
    if (!in_array($key, $allowedParams, true)) {
        jsonError(
            400,
            "Desteklenmeyen parametre: {$key}"
        );
    }

    if (!is_string($value)) {
        jsonError(
            400,
            "{$key} tek bir değer olmalıdır."
        );
    }
}

$params = [];

foreach ($allowedParams as $key) {
    if (isset($_GET[$key]) && $_GET[$key] !== '') {
        $params[$key] = trim((string) $_GET[$key]);
    }
}

if (isset($params['eventid'])) {
    if (!preg_match('/^\d{1,20}$/', $params['eventid'])) {
        jsonError(
            400,
            'Event ID yalnızca rakamlardan oluşmalıdır.'
        );
    }

    $params = [
        'eventid' => $params['eventid'],
        'format' => 'json',
    ];
} else {
    if (!isset($params['start'], $params['end'])) {
        jsonError(
            400,
            'Başlangıç ve bitiş tarihleri zorunludur.'
        );
    }

    if (
        !isValidDateTime($params['start'])
        || !isValidDateTime($params['end'])
    ) {
        jsonError(
            400,
            'Tarih biçimi YYYY-MM-DDTHH:MM:SS olmalıdır.'
        );
    }

    if ($params['start'] > $params['end']) {
        jsonError(
            400,
            'Başlangıç tarihi bitiş tarihinden sonra olamaz.'
        );
    }

    $numberRules = [
        'minmag' => [0, 10],
        'maxmag' => [0, 10],
        'mindepth' => [0, 1000],
        'maxdepth' => [0, 1000],
        'minlat' => [-90, 90],
        'maxlat' => [-90, 90],
        'minlon' => [-180, 180],
        'maxlon' => [-180, 180],
        'lat' => [-90, 90],
        'lon' => [-180, 180],
        'minrad' => [0, 20000000],
        'maxrad' => [0, 20000000],
        'limit' => [1, 25000],
    ];

    foreach ($numberRules as $name => $range) {
        if (isset($params[$name])) {
            validateNumber(
                $name,
                $params[$name],
                $range[0],
                $range[1]
            );
        }
    }

    foreach (
        [
            [
                'minmag',
                'maxmag',
                'Minimum büyüklük maksimumdan büyük olamaz.',
            ],
            [
                'mindepth',
                'maxdepth',
                'Minimum derinlik maksimumdan büyük olamaz.',
            ],
            [
                'minlat',
                'maxlat',
                'Minimum enlem maksimumdan büyük olamaz.',
            ],
            [
                'minlon',
                'maxlon',
                'Minimum boylam maksimumdan büyük olamaz.',
            ],
            [
                'minrad',
                'maxrad',
                'Minimum mesafe maksimumdan büyük olamaz.',
            ],
        ] as $comparison
    ) {
        [$minKey, $maxKey, $message] = $comparison;

        if (
            isset($params[$minKey], $params[$maxKey])
            && (float) $params[$minKey]
                > (float) $params[$maxKey]
        ) {
            jsonError(400, $message);
        }
    }

    $rectKeys = [
        'minlat',
        'maxlat',
        'minlon',
        'maxlon',
    ];

    $radialKeys = [
        'lat',
        'lon',
        'maxrad',
    ];

    $hasRect =
        count(
            array_intersect(
                $rectKeys,
                array_keys($params)
            )
        ) > 0;

    $hasRadial =
        count(
            array_intersect(
                $radialKeys,
                array_keys($params)
            )
        ) > 0;

    if ($hasRect && $hasRadial) {
        jsonError(
            400,
            'Dikdörtgen ve radyal filtreler birlikte kullanılamaz.'
        );
    }

    if (
        $hasRect
        && count(
            array_intersect(
                $rectKeys,
                array_keys($params)
            )
        ) !== count($rectKeys)
    ) {
        jsonError(
            400,
            'Dikdörtgen filtre için dört koordinat da zorunludur.'
        );
    }

    if (
        $hasRadial
        && count(
            array_intersect(
                $radialKeys,
                array_keys($params)
            )
        ) !== count($radialKeys)
    ) {
        jsonError(
            400,
            'Radyal filtre için lat, lon ve maxrad zorunludur.'
        );
    }

    $allowedMagTypes = [
        'ML',
        'Mw',
        'Ms',
        'mb',
        'md',
    ];

    if (
        isset($params['magtype'])
        && !in_array(
            $params['magtype'],
            $allowedMagTypes,
            true
        )
    ) {
        jsonError(
            400,
            'Geçersiz büyüklük tipi.'
        );
    }

    $allowedOrder = [
        'timedesc',
        'time',
        'magnitudedesc',
        'magnitude',
    ];

    if (
        isset($params['orderby'])
        && !in_array(
            $params['orderby'],
            $allowedOrder,
            true
        )
    ) {
        jsonError(
            400,
            'Geçersiz sıralama değeri.'
        );
    }

    $params['limit'] = $params['limit'] ?? '500';
    $params['format'] = 'json';
}

// Önce ortak sunucu cache'ine bak.
$cached = readServerCache($params);

if ($cached !== null) {
    echo $cached;
    exit;
}

header('X-Proxy-Cache: MISS');

$url =
    AFAD_API_URL
    . '?'
    . http_build_query(
        $params,
        '',
        '&',
        PHP_QUERY_RFC3986
    );

if (function_exists('curl_init')) {
    [$upstreamStatus, $data, $transportError] =
        fetchWithCurl($url);
} else {
    [$upstreamStatus, $data, $transportError] =
        fetchWithStreams($url);
}

if ($data === false) {
    $status =
        $upstreamStatus === 504
            ? 504
            : 502;

    jsonError(
        $status,
        $status === 504
            ? 'AFAD API isteği zaman aşımına uğradı.'
            : 'AFAD API bağlantısı kurulamadı.'
    );
}

if (
    $upstreamStatus < 200
    || $upstreamStatus >= 300
) {
    jsonError(
        502,
        "AFAD API HTTP {$upstreamStatus} hatası döndürdü."
    );
}

json_decode($data, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    jsonError(
        502,
        'AFAD API geçersiz JSON yanıtı döndürdü.'
    );
}

writeServerCache($params, $data);

echo $data;
