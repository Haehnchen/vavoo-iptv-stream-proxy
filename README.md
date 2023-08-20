# VAVOO.TV Streaming Proxy

VAVOO.TV is a Mobile app for streaming TV (IPTV), via channel list (so called bundles).

This project allows the stream to playback via common software like VLC, ffmpeg, ... that support m3u8 and also enigma2 based receivers, via a simple node.js HTTP application.

## Problems

Project resolve the following "problems" via proxy / redirect the streaming URL:

### VAVOO.TV

- URLs for streams are changing frequently, but identified by a unique name
- Stream urls are normally not accessible unless you provide a `User-Agent: "VAVOO/2.6"` inside the HTTP request :)
- Stream urls require an "auth_token" :)

### Software issues

Not all Software like IPTV application for hardware receiver support the feature to provide a User-Agent HTTP header.

- VLC, gstreamer, ffmpeg support it with since some versions
- m3u8 playlist supports it, but not every software taking to account

```
#EXTM3U
#EXTINF:-1 tvg-name="ARD (3)" group-title="Germany" tvg-logo="" tvg-id="ARD (3)",ARD (3)
#EXTVLCOPT:http-user-agent=VAVOO/2.6
```

- common enigma2 bouquet format also support via gstreamer

```
#NAME iptv - All Channels
#SERVICE 1:0:1:0:0:0:0:0:0:0:http%3A%2F%2F127.0.0.1%3A8888%2Fstream%2F290116820#sapp_tvgid=ARD (3)&User-Agent=VAVOO/2.6:ARD (3)
#DESCRIPTION ARD (3)
```

- Requests that access internal stream via the required `User-Agent` get fill piped via a simple proxy request to the vavvo URL
- If right `User-Agent` is given for the request there is just an HTTP redirect to the final vavvo URL

## Install & Start

```
npm install
node.js index.php
```

```
cp .env.dist cp .env
```

Provide dotenv values for the following values. Google your self !!!

```
# .env
BUNDLE_URL=URL (hint: its just a m3u8)
```

All `vavookeys` (google it) need to be put into the root directory near by `index.js`

Download channel via browser open it via you favorite application; best use with VLC via network stream

```
http:/127.0.0.1:8888/channels.m3u8
```

## HTTP Endpoints

### Channel-lists

```
# VLC, ffmpeg, ...
[GET] http:/127.0.0.1:8888/channels.m3u8
```

```
# for enigma2 based receivers
[GET] http:/127.0.0.1:8888/channels.bouquet
```

### Streaming Callback

Callback for streaming:

- If HTTP User-Agent is includes "vavoo" its just a redirect "VAVOO/2.6",
- On vavoo User-Agent not given, its a proxy endpoint

```
[GET] http:/127.0.0.1:8888/stream/:id
```
