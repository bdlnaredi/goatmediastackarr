<?php
// GoatMediaStackarr: the gatekeeper in front of ruTorrent (served by PHP's own web server on port 8090).
// ruTorrent has no sign-in of its own; a web server is meant to provide one. This asks for the login GoatMediaStackarr
// made (shown on the Stack page, under "Logins made for you"), and keeps ruTorrent's settings and data folders private,
// as ruTorrent's own .htaccess example does.
$user = getenv('RU_USER'); $pass = getenv('RU_PASS');
if ($user !== false && $user !== '') {
  $u = $_SERVER['PHP_AUTH_USER'] ?? ''; $p = $_SERVER['PHP_AUTH_PW'] ?? '';
  if (!hash_equals($user, $u) || !hash_equals((string)$pass, $p)) {
    header('WWW-Authenticate: Basic realm="ruTorrent (GoatMediaStackarr)", charset="UTF-8"');
    http_response_code(401);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Sign in with the ruTorrent login shown on GoatMediaStackarr's Stack page (Logins made for you).\n";
    return true;
  }
}
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/');
// /RPC2: rTorrent's XML-RPC, for the apps inside the container (Sonarr, Radarr, Lidarr, Prowlarr, GoatMediaStackarr).
// Sent to rTorrent as trusted, like a web server's SCGI mount would; ruTorrent's own plugin marks raw commands as
// untrusted, and rTorrent 0.16 then refuses starting or removing torrents. Only answered from inside the container.
if ($path === '/RPC2') {
  $from = $_SERVER['REMOTE_ADDR'] ?? '';
  if ($from !== '127.0.0.1' && $from !== '::1') { http_response_code(403); header('Content-Type: text/plain'); echo "Only for apps inside the container.\n"; return true; }
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); return true; }
  require_once($_SERVER['DOCUMENT_ROOT'] . '/php/xmlrpc.php');
  $answer = rXMLRPCRequest::send(file_get_contents('php://input'), true);
  if ($answer === false) { http_response_code(502); header('Content-Type: text/plain'); echo "rTorrent is not answering.\n"; return true; }
  $at = strpos($answer, "\r\n\r\n");
  header('Content-Type: text/xml');
  echo $at === false ? $answer : substr($answer, $at + 4);
  return true;
}
if (preg_match('#(^|/)\.\.(/|$)#', $path) || preg_match('#^/(conf|share|tests)(/|$)#', $path) || preg_match('#/\.(ht|git)#', $path)) {
  http_response_code(403); header('Content-Type: text/plain'); echo "Forbidden\n"; return true;
}
return false; // let PHP's server send the file or run the script
