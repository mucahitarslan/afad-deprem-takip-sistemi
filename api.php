<?php
// api.php — AFAD API Proxy
// Tarayıcıdan /api.php?... şeklinde çağrılır,
// servisnet.afad.gov.tr'a iletir ve yanıtı döner.

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

$base = 'https://servisnet.afad.gov.tr/apigateway/deprem/apiv2/event/filter';
$qs   = $_SERVER['QUERY_STRING'] ?? '';
$url  = $qs ? "$base?$qs" : $base;

$ctx = stream_context_create(['http' => [
    'method'  => 'GET',
    'header'  => "User-Agent: DepremTakip/2.0\r\nAccept: application/json\r\n",
    'timeout' => 15,
]]);

$data = @file_get_contents($url, false, $ctx);

if ($data === false) {
    http_response_code(502);
    echo json_encode(['error' => 'AFAD API ulaşılamıyor']);
    exit;
}

echo $data;
