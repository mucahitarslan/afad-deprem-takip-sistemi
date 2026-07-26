<?php
declare(strict_types=1);

// api.php — Güvenli AFAD API proxy'si (PHP 7.4+)

header('Content-Type: application/json; charset=utf-8');

const AFAD_API_URL = 'https://servisnet.afad.gov.tr/apigateway/deprem/apiv2/event/filter';

function jsonError(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(
        ['error' => $message],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

function isValidDateTime(string $value): bool
{
    $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s', $value);
    return $date !== false && $date->format('Y-m-d\TH:i:s') === $value;
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
        jsonError(400, "{$name} {$min} ile {$max} arasında olmalıdır.");
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    jsonError(405, 'Yalnızca GET istekleri desteklenir.');
}

$allowedParams = [
    'start', 'end', 'minmag', 'maxmag', 'magtype',
    'mindepth', 'maxdepth', 'minlat', 'maxlat', 'minlon', 'maxlon',
    'lat', 'lon', 'minrad', 'maxrad', 'limit', 'orderby',
    'eventid', 'format',
];

foreach ($_GET as $key => $value) {
    if (!in_array($key, $allowedParams, true)) {
        jsonError(400, "Desteklenmeyen parametre: {$key}");
    }
    if (!is_string($value)) {
        jsonError(400, "{$key} tek bir değer olmalıdır.");
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
        jsonError(400, 'Event ID yalnızca rakamlardan oluşmalıdır.');
    }
    $params = ['eventid' => $params['eventid'], 'format' => 'json'];
} else {
    if (!isset($params['start'], $params['end'])) {
        jsonError(400, 'Başlangıç ve bitiş tarihleri zorunludur.');
    }
    if (!isValidDateTime($params['start']) || !isValidDateTime($params['end'])) {
        jsonError(400, 'Tarih biçimi YYYY-MM-DDTHH:MM:SS olmalıdır.');
    }
    if ($params['start'] > $params['end']) {
        jsonError(400, 'Başlangıç tarihi bitiş tarihinden sonra olamaz.');
    }

    $numberRules = [
        'minmag' => [0, 10], 'maxmag' => [0, 10],
        'mindepth' => [0, 1000], 'maxdepth' => [0, 1000],
        'minlat' => [-90, 90], 'maxlat' => [-90, 90],
        'minlon' => [-180, 180], 'maxlon' => [-180, 180],
        'lat' => [-90, 90], 'lon' => [-180, 180],
        'minrad' => [0, 20000000], 'maxrad' => [0, 20000000],
        'limit' => [1, 25000],
    ];
    foreach ($numberRules as $name => $range) {
        if (isset($params[$name])) {
            validateNumber($name, $params[$name], $range[0], $range[1]);
        }
    }

    foreach ([
        ['minmag', 'maxmag', 'Minimum büyüklük maksimumdan büyük olamaz.'],
        ['mindepth', 'maxdepth', 'Minimum derinlik maksimumdan büyük olamaz.'],
        ['minlat', 'maxlat', 'Minimum enlem maksimumdan büyük olamaz.'],
        ['minlon', 'maxlon', 'Minimum boylam maksimumdan büyük olamaz.'],
        ['minrad', 'maxrad', 'Minimum mesafe maksimumdan büyük olamaz.'],
    ] as $comparison) {
        [$minKey, $maxKey, $message] = $comparison;
        if (isset($params[$minKey], $params[$maxKey])
            && (float) $params[$minKey] > (float) $params[$maxKey]) {
            jsonError(400, $message);
        }
    }

    $rectKeys = ['minlat', 'maxlat', 'minlon', 'maxlon'];
    $radialKeys = ['lat', 'lon', 'maxrad'];
    $hasRect = count(array_intersect($rectKeys, array_keys($params))) > 0;
    $hasRadial = count(array_intersect($radialKeys, array_keys($params))) > 0;

    if ($hasRect && $hasRadial) {
        jsonError(400, 'Dikdörtgen ve radyal filtreler birlikte kullanılamaz.');
    }
    if ($hasRect && count(array_intersect($rectKeys, array_keys($params))) !== count($rectKeys)) {
        jsonError(400, 'Dikdörtgen filtre için dört koordinat da zorunludur.');
    }
    if ($hasRadial && count(array_intersect($radialKeys, array_keys($params))) !== count($radialKeys)) {
        jsonError(400, 'Radyal filtre için lat, lon ve maxrad zorunludur.');
    }

    $allowedMagTypes = ['ML', 'Mw', 'Ms', 'mb', 'md'];
    if (isset($params['magtype']) && !in_array($params['magtype'], $allowedMagTypes, true)) {
        jsonError(400, 'Geçersiz büyüklük tipi.');
    }

    $allowedOrder = ['timedesc', 'time', 'magnitudedesc', 'magnitude'];
    if (isset($params['orderby']) && !in_array($params['orderby'], $allowedOrder, true)) {
        jsonError(400, 'Geçersiz sıralama değeri.');
    }

    $params['limit'] = $params['limit'] ?? '500';
    $params['format'] = 'json';
}

$url = AFAD_API_URL . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

function fetchWithCurl(string $url): array
{
    $curl = curl_init($url);
    if ($curl === false) {
        return [0, false, 'cURL başlatılamadı.'];
    }

    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'User-Agent: DepremTakip/2.0',
        ],
    ]);

    $data = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $errorNumber = curl_errno($curl);
    $error = curl_error($curl);

    if ($data === false) {
        return [$errorNumber === CURLE_OPERATION_TIMEDOUT ? 504 : 502, false, $error];
    }

    return [$status, $data, ''];
}

function fetchWithStreams(string $url): array
{
    if (!filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        return [0, false, 'Sunucuda cURL ve allow_url_fopen kullanılamıyor.'];
    }

    $context = stream_context_create(['http' => [
        'method' => 'GET',
        'header' => "User-Agent: DepremTakip/2.0\r\nAccept: application/json\r\n",
        'timeout' => 15,
        'ignore_errors' => true,
    ]]);

    $data = @file_get_contents($url, false, $context);
    $responseHeaders = function_exists('http_get_last_response_headers')
        ? http_get_last_response_headers()
        : (get_defined_vars()['http_response_header'] ?? []);
    $status = 0;
    if (isset($responseHeaders[0])
        && preg_match('/\s(\d{3})\s/', $responseHeaders[0], $match)) {
        $status = (int) $match[1];
    }

    return [$status, $data, $data === false ? 'Akış isteği başarısız oldu.' : ''];
}

if (function_exists('curl_init')) {
    [$upstreamStatus, $data, $transportError] = fetchWithCurl($url);
} else {
    [$upstreamStatus, $data, $transportError] = fetchWithStreams($url);
}

if ($data === false) {
    $status = $upstreamStatus === 504 ? 504 : 502;
    jsonError($status, $status === 504
        ? 'AFAD API isteği zaman aşımına uğradı.'
        : 'AFAD API bağlantısı kurulamadı.');
}

if ($upstreamStatus < 200 || $upstreamStatus >= 300) {
    jsonError(502, "AFAD API HTTP {$upstreamStatus} hatası döndürdü.");
}

json_decode($data, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    jsonError(502, 'AFAD API geçersiz JSON yanıtı döndürdü.');
}

echo $data;
