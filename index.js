const { Command } = require('commander');
const express = require('express');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const NodeCache = require('node-cache');

const program = new Command();

program
    .name('vavoo-iptv-stream-proxy')
    .description('Local proxy for Vavoo IPTV streams')
    .option('--http-host <host>', 'Local HTTP host for displayed URLs', '127.0.0.1')
    .option('--http-port <port>', 'Local HTTP port', '8888')
    .option('--vavoo-language <language>', 'Language sent to Vavoo APIs, e.g. de or optional en', 'de')
    .option('--vavoo-region <region>', 'Region sent to Vavoo APIs, default US for a broad catalog, optional DE which tends to prefilter strongly toward Germany', 'US')
    .option('--vavoo-url-list <selection>', 'URL list to use: primary, fallback, both', 'both')
    .parse(process.argv);

const options = program.opts();

function getBaseSites(selection) {
    const normalized = String(selection || 'both').trim().toLowerCase();

    if (normalized === 'primary') {
        return ['https://vavoo.to'];
    }

    if (normalized === 'fallback') {
        return ['https://kool.to'];
    }

    return ['https://vavoo.to', 'https://kool.to'];
}

const app = express();
const httpHost = options.httpHost;
const port = Number(options.httpPort);
const currentLanguage = options.vavooLanguage;
const currentRegion = options.vavooRegion;
const vavooUrlList = options.vavooUrlList;
const baseSites = getBaseSites(vavooUrlList);

const cache = new NodeCache();

const CHANNELS_CACHE_KEY = 'vavoo_channels';
const SIGNATURE_CACHE_KEY = 'vavoo_addon_sig';
const COUNTRY_SEPARATORS = ['➾', '⟾', '->', '→', '»', '›'];
const PING_URLS = [
    'https://www.lokke.app/api/app/ping',
    'https://www.vavoo.tv/api/app/ping'
];

function getLocalBaseUrl() {
    return `http://${httpHost}:${port}`;
}

function buildHomePage() {
    const baseUrl = getLocalBaseUrl();
    const allM3u = `${baseUrl}/channels.m3u8`;
    const germanyM3u = `${baseUrl}/channels.m3u8?country=Germany`;
    const italyM3u = `${baseUrl}/channels.m3u8?country=Italy`;
    const franceM3u = `${baseUrl}/channels.m3u8?country=France`;
    const spainM3u = `${baseUrl}/channels.m3u8?country=Spain`;
    const ukM3u = `${baseUrl}/channels.m3u8?country=${encodeURIComponent('United Kingdom')}`;
    const countriesUrl = `${baseUrl}/countries`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vavoo Proxy</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111111;
      --text: #f3f3f3;
      --muted: #b8b8b8;
      --link: #8fd3ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    main {
      max-width: 760px;
      margin: 0 auto;
      padding: 24px 18px 40px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
    }
    p {
      margin: 0 0 18px;
      color: var(--muted);
    }
    ul {
      margin: 0;
      padding-left: 20px;
    }
    li { margin: 10px 0; }
    a {
      color: var(--link);
      word-break: break-all;
    }
    code {
      color: var(--text);
    }
  </style>
</head>
<body>
  <main>
    <h1>Vavoo Proxy</h1>
    <p>Local entry points for playlists and stream playback.</p>
    <ul>
      <li><a href="${baseUrl}/">${baseUrl}/</a></li>
      <li><a href="${allM3u}">${allM3u}</a></li>
      <li><a href="${germanyM3u}">${germanyM3u}</a></li>
      <li><a href="${italyM3u}">${italyM3u}</a></li>
      <li><a href="${franceM3u}">${franceM3u}</a></li>
      <li><a href="${spainM3u}">${spainM3u}</a></li>
      <li><a href="${ukM3u}">${ukM3u}</a></li>
      <li><a href="${countriesUrl}">${countriesUrl}</a></li>
    </ul>
  </main>
</body>
</html>`;
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function extractCountry(group) {
    const rawGroup = String(group || '').trim();
    if (!rawGroup) {
        return 'default';
    }

    for (const separator of COUNTRY_SEPARATORS) {
        if (rawGroup.includes(separator)) {
            return rawGroup.split(separator)[0].trim() || 'default';
        }
    }

    return rawGroup;
}

function getCatalogHeaders(signature) {
    return {
        'content-type': 'application/json; charset=utf-8',
        'mediahubmx-signature': signature,
        'user-agent': 'MediaHubMX/2',
        'accept': '*/*',
        'Accept-Language': currentLanguage,
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'close',
    };
}

function getPingPayload() {
    const currentTimestamp = Date.now();

    return {
        reason: 'app-focus',
        locale: currentLanguage,
        theme: 'dark',
        metadata: {
            device: {
                type: 'desktop',
                uniqueId: `node-${currentTimestamp}`
            },
            os: {
                name: 'linux',
                version: 'Linux',
                abis: ['x64'],
                host: 'node'
            },
            app: {
                platform: 'electron'
            },
            version: {
                package: 'tv.vavoo.app',
                binary: '3.1.8',
                js: '3.1.8'
            }
        },
        appFocusTime: 0,
        playerActive: false,
        playDuration: 0,
        devMode: false,
        hasAddon: true,
        castConnected: false,
        package: 'tv.vavoo.app',
        version: '3.1.8',
        process: 'app',
        firstAppStart: currentTimestamp,
        lastAppStart: currentTimestamp,
        ipLocation: null,
        adblockEnabled: true,
        proxy: {
            supported: ['ss'],
            engine: 'Mu',
            enabled: false,
            autoServer: true
        },
        iap: {
            supported: false
        }
    };
}

async function requestJson(options) {
    const response = await fetch(options.url, {
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeout || 30000),
    });

    const body = await response.json();

    if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${options.url}`);
        error.statusCode = response.status;
        error.body = body;
        throw error;
    }

    return body;
}

async function getAddonSignature() {
    const cached = cache.get(SIGNATURE_CACHE_KEY);
    if (cached) {
        return cached;
    }

    const payload = getPingPayload();

    for (const url of PING_URLS) {
        try {
            const body = await requestJson({
                method: 'POST',
                url,
                body: payload,
            });

            const signature = body?.addonSig;
            if (signature) {
                cache.set(SIGNATURE_CACHE_KEY, signature, 300);
                return signature;
            }
        } catch (error) {
            console.log(`[vavoo] addonSig request failed for ${url}: ${error.message}`);
        }
    }

    throw new Error('Unable to obtain addonSig');
}

function mapCatalogItem(item) {
    return {
        id: String(item?.ids?.id || item?.id || item?.url),
        url: item.url,
        name: item.name || 'Unknown Channel',
        logo: item.logo || '',
        group: item.group || '',
        country: extractCountry(item.group)
    };
}

async function loadCatalogFromBase(baseUrl, signature) {
    const catalogUrl = `${baseUrl.replace(/\/$/, '')}/mediahubmx-catalog.json`;
    const headers = getCatalogHeaders(signature);
    const channels = [];
    let cursor = null;

    while (true) {
        const body = await requestJson({
            method: 'POST',
            url: catalogUrl,
            headers,
            body: {
                language: currentLanguage,
                region: currentRegion,
                catalogId: 'iptv',
                id: 'iptv',
                adult: false,
                search: '',
                sort: '',
                filter: {},
                cursor,
                clientVersion: '3.0.2'
            }
        });

        const items = Array.isArray(body?.items) ? body.items : [];
        for (const item of items) {
            if (item?.type === 'iptv' && item?.url) {
                channels.push(mapCatalogItem(item));
            }
        }

        if (!body?.nextCursor) {
            break;
        }

        cursor = body.nextCursor;
    }

    return channels;
}

async function getChannels(forceRefresh = false) {
    if (forceRefresh) {
        cache.del(CHANNELS_CACHE_KEY);
    }

    const cached = cache.get(CHANNELS_CACHE_KEY);
    if (cached) {
        return cached;
    }

    const signature = await getAddonSignature();

    for (const baseUrl of baseSites) {
        try {
            const channels = await loadCatalogFromBase(baseUrl, signature);
            cache.set(CHANNELS_CACHE_KEY, channels, 300);
            console.log(`[vavoo] channels loaded from ${baseUrl}: ${channels.length}`);
            return channels;
        } catch (error) {
            console.log(`[vavoo] catalog load failed for ${baseUrl}: ${error.message}`);
        }
    }

    throw new Error('Unable to load channel catalog');
}

async function getChannelsByCountry(country) {
    const channels = await getChannels();
    return channels.filter((channel) => normalize(channel.country) === normalize(country));
}

async function getCountries() {
    const channels = await getChannels();
    return [...new Set(
        channels
            .map((channel) => channel.country)
            .filter((country) => country && normalize(country) !== 'default')
    )].sort((left, right) => left.localeCompare(right));
}

async function findChannelById(id) {
    const channels = await getChannels();
    return channels.find((channel) => String(channel.id) === String(id));
}

async function resolveStreamUrl(channel) {
    const signature = await getAddonSignature();

    for (const baseUrl of baseSites) {
        const resolveUrl = `${baseUrl.replace(/\/$/, '')}/mediahubmx-resolve.json`;

        try {
            const body = await requestJson({
                method: 'POST',
                url: resolveUrl,
                headers: getCatalogHeaders(signature),
                body: {
                    language: currentLanguage,
                    region: currentRegion,
                    url: channel.url,
                    clientVersion: '3.0.2'
                }
            });

            if (Array.isArray(body) && body[0]?.url) {
                return body[0].url;
            }

            if (body?.url) {
                return body.url;
            }

            if (body?.streamUrl) {
                return body.streamUrl;
            }
        } catch (error) {
            console.log(`[vavoo] resolve failed for ${baseUrl}: ${error.message}`);
        }
    }

    throw new Error(`Unable to resolve stream for channel ${channel.name}`);
}

async function proxyStream(req, res, streamUrl, channelName) {
    const connId = `${req.socket.remoteAddress}`;
    const controller = new AbortController();

    req.socket.on('close', function () {
        console.log(`[${connId}] connection closed`);
        controller.abort();
    });

    try {
        const upstream = await fetch(streamUrl, {
        signal: controller.signal,
        headers: {
            'User-Agent': 'VAVOO/2.6',
            'Connection': 'close'
        }
        });

        if (!upstream.ok || !upstream.body) {
            throw new Error(`upstream returned HTTP ${upstream.status}`);
        }

        const contentType = upstream.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        const contentLength = upstream.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        const acceptRanges = upstream.headers.get('accept-ranges');
        if (acceptRanges) {
            res.setHeader('Accept-Ranges', acceptRanges);
        }

        console.log(`[${connId}] starting stream proxy "${channelName}"`);
        await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
        if (controller.signal.aborted) {
            console.log(`[${connId}] stream ended "${channelName}"`);
            return;
        }

        console.log(`[${connId}] stream error "${channelName}": ${error.message}`);
        if (!res.headersSent) {
            res.status(400).send(`stream error: ${error.message}`);
        }
    }
}

app.get('/', function (req, res) {
    res.type('html').send(buildHomePage());
});

app.get('/countries', async function (req, res) {
    try {
        res.json(await getCountries());
    } catch (error) {
        console.log('[vavoo] countries error', error.message);
        res.status(500).send(error.message);
    }
});

app.get('/channels.m3u8', async function (req, res) {
    try {
        const country = req.query.country;
        const channels = country ? await getChannelsByCountry(country) : await getChannels();
        const output = ['#EXTM3U'];

        for (const channel of channels) {
            output.push(`#EXTINF:-1 tvg-name="${channel.name}" group-title="${channel.country}" tvg-logo="${channel.logo}" tvg-id="${channel.name}",${channel.name}`);
            output.push('#EXTVLCOPT:http-user-agent=VAVOO/2.6');
            output.push(`${req.protocol}://${req.headers.host}/stream/${encodeURIComponent(channel.id)}`);
        }

        res.send(output.join('\n'));
    } catch (error) {
        console.log('[vavoo] channels.m3u8 error', error.message);
        res.status(500).send(error.message);
    }
});

app.get('/stream/:id', async function (req, res) {
    const connId = `${req.socket.remoteAddress}`;
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    try {
        console.log(`[${connId}] connection opened: "${userAgent}"`);

        const channel = await findChannelById(req.params.id);
        if (!channel) {
            res.status(404).send(`unknown channel: ${req.params.id}`);
            return;
        }

        const streamUrl = await resolveStreamUrl(channel);
        console.log(`[${connId}] resolved "${channel.name}": ${streamUrl}`);

        if (userAgent.toLowerCase().includes('vavoo')) {
            res.redirect(streamUrl);
            return;
        }

        await proxyStream(req, res, streamUrl, channel.name);
    } catch (error) {
        console.log(`[${connId}] playback error`, error.message);
        res.status(500).send(error.message);
    }
});

app.listen(port, () => {
    const baseUrl = getLocalBaseUrl();
    console.log(`Listening on ${baseUrl}/`);
    console.log(`M3U: ${baseUrl}/channels.m3u8`);
    console.log(`Example filtered M3U: ${baseUrl}/channels.m3u8?country=Germany`);
    console.log(`Countries: ${baseUrl}/countries`);
});
