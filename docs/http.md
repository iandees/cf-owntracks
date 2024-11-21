## HTTP

An optional HTTP mode is implemented with which the OwnTracks apps use a privately configured HTTP endpoint (a.k.a. a Web server) to which they POST requests over HTTP instead of publishing to MQTT. In this mode all [JSON](json.md) payloads reported by the apps are transmitted via HTTP to the endpoint. In particular and most importantly, the apps publish their location data. Note that the length of the payload may be zero if a friend is deleted from the app: the zero-length message which is normally published via MQTT will be POSTed via HTTP to your endpoint; as such it is best to ignore zero-length payloads.

The URL you enter in the setting for HTTP mode has the following syntax:

```
http[s]://[user[:password]@]host[:port]/path
```

Authentication to the endpoint is performed with HTTP Basic authentication and, as such, we very strongly recommend the use of TLS (`https://` scheme). The [encryption](../features/encrypt.md) feature is supported, and you can use it with HTTP endpoints; the Owntracks Recorder supports decryption, but if you implement your own endpoint you have to perform decryption at the endpoint yourself.

The Recorder supports [HTTP mode](https://github.com/owntracks/recorder#http-mode) out of the box at the `/pub` end point, as long as it is built with HTTP support and a `--http-port` is configured. When using Recorder in this mode, set the URL to:

```
http[s]://recorder_host[:port]/pub
```

The username and password for HTTP Basic authentication can be configured in application settings, under *Identification*. Device name and tracker name can also be configured there. Username and device name are *required* when using the Recorder. Parameters for _username_ and _devicename_ can also be included in the URL (`?u=user&d=device`), or alternatively using the `X-Limit-U` and `X-Limit-D` headers respectively. You can also force _username_ using a proxy as described in the Recorder's documentation.

All publishes which are currently done with MQTT will then be POSTed to the endpoint with exactly the same [JSON](json.md) payload formats. Support for Friends is available if your HTTP endpoint can produce appropriate data which is consumed by the app whenever it POSTs a location. This differs greatly from MQTT mode wherein the app subscribes to topics and is informed of data on those topics whenever it's available; in HTTP mode the apps do not periodically poll your HTTP endpoint; rather it is contacted only when the app is ready to publish its location or when you manually trigger a publish. (Support for friends and optionally their cards is implemented in the Recorder.)

If the HTTP endpoint is reachable (no exception, no timeout, DNS name exists, etc.) and a successfull return code (`2xx`) is returned  the payload is considered POSTed. In the event that the endpoint is unreachable, the payload will be queued and posted at a later time.

If the HTTP endpoint returns a status code 200 it will typically return an empty JSON payload array `[]`. It may, however, return an array of JSON objects to the OwnTracks device, each of which must be a valid `_type` as described in [JSON](../tech/json.md). Support for the following `_type` is implemented:

| `_type`      |  iOS  | Android    | Usage
| :----------- | :---  | :--- | :--------------
| `location`   | Y     | Y    | Can return friend location objects.
| `cmd`        | Y     | Y    | with `action` set to `dump`, `reportLocation`, `reportSteps`, `action`, and `setWaypoints`
| `card`       | Y     | Y    | Can return [card](../features/card.md) objects for self and friends
| `transition` | Y     | Y    | Obtain friends' transition events.

## Distinguishing payloads

When a message is received over MQTT, the payload is sent to a topic, and this topic can be used to map the message to the user and their device. In the case that a message is received over HTTP, we don't have the context of a topic; instead, the iOS and Android apps use a different approach to help you figure out where the message came from:

- On iOS, a new `topic` key is added to the payload if the payload is unencrypted. If the payload is encrypted, the `topic` key is only available in the decrypted payload.
- Both the Android and iOS apps (iOS after [#560](https://github.com/owntracks/ios/issues/560) is implemented) include headers to identify the user (`X-Limit-U`) and the device (`X-Limit-D`) if the user has entered this information in the "Identification" section of the connection settings.

```
Content-Type: application/json
X-Limit-U: jjolie
X-Limit-D: myphone
```

## PHP example

Using a simple PHP script which you host, say, on an Apache or nginx server, you can quite easily record locations POSTed from the OwnTracks apps. The following very simple example will fill a database table:

```
mysql> select * from locations;
+---------------------+------+-----------+----------+
| dt                  | tid  | lat       | lon      |
+---------------------+------+-----------+----------+
| 2016-02-20 09:16:05 | JJ   | 48.858330 | 2.295130 |
| 2016-02-20 09:19:49 | JJ   | 48.860430 | 2.294010 |
+---------------------+------+-----------+----------+
```

For the sake of clarity this example uses a database table with a MySQL timestamp column which is automatically set upon INSERT; keep in mind that the real location event posted by the OwnTracks apps has a `tst` timestamp when the event actually occurred.

```php
<?php
    # Obtain the JSON payload from an OwnTracks app POSTed via HTTP
    # and insert into database table.

    header("Content-type: application/json");

    $payload = file_get_contents("php://input");
    $data =  @json_decode($payload, true);

    if ($data['_type'] == 'location') {

        # CREATE TABLE locations (dt TIMESTAMP, tid CHAR(2), lat DECIMAL(9,6), lon DECIMAL(9,6));
        $mysqli = new mysqli("127.0.0.1", "user", "password", "database");

        $tst = $data['tst'];
        $lat = $data['lat'];
        $lon = $data['lon'];
        $tid = $data['tid'];

        # Convert timestamp to a format suitable for mysql
        $dt = date('Y-m-d H:i:s', $tst);

        $sql = "INSERT INTO locations (dt, tid, lat, lon) VALUES (?, ?, ?, ?)";
        $stmt = $mysqli->prepare($sql);
        # bind parameters (s = string, i = integer, d = double,  b = blob)
        $stmt->bind_param('ssdd', $dt, $tid, $lat, $lon);
        $stmt->execute();
        $stmt->close();
    }

    $response = array();
    # optionally add objects to return to the app (e.g.
    # friends or cards)
    print json_encode($response);
?>
```

Assuming the Web server hosting this example is called `example.com`, and assuming the above script is in Jane's home directory's `public_html` saved as `loc.php`, the URL you configure in the OwnTracks app would be `http://example.com/~jane/loc.php`. We _urge_ you to consider transmitting your data to your Web server securely using TLS and authentication, in which case the URL you use will be along the lines of `https://user:password@example.com/~jane/loc.php`.

There's lots of other data in the JSON payload from the OwnTracks apps you may be interested in; we reccomend you [study the API documentation](json.md).

## Testing your HTTP endpoint

An simple example for testing a HTTP endpoint you set up:

```bash
#!/bin/sh

user=jane
device=phone

payload=$(jo _type=location \
   t=u \
   batt=11 \
   lat=48.856826 \
   lon=2.292713 \
   tid=JJ \
   tst=$(date +%s) \
   topic="owntracks/$user/$device")

curl --data "${payload}" http://127.0.0.1:8085/pub?u=${user}&d=${device}
```

* see also: [Traccar](../features/traccar.md)