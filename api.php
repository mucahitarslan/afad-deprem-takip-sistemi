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

$ctx = stream_context_create(['http' => [
    'method' => 'GET',
    'header' => "User-Agent: DepremTakip/2.0\r\nAccept: application/json\r\n",
    'timeout' => 15,
    'ignore_errors' => true,
]]);

$data = @file_get_contents($url, false, $ctx);

if ($data === false) {
    jsonError(502, 'AFAD API ulaşılamıyor.');
}

echo $data;
