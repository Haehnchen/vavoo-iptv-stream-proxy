require('dotenv').config();

const express = require('express');
const request = require('request');
const fs = require("fs");
const https = require("https");
const readline = require('readline');

const app = express();
const port = process.env.HTTP_PORT || 8888;
const vavooPingUrl = process.env.VAVOO_PING_URL;
const bundleUrl = process.env.BUNDLE_URL;

const NodeCache = require("node-cache");
const cache = new NodeCache();

function chunks(array, size) {
    const results = [];
    while (array.length) {
        results.push(array.splice(0, size));
    }
    return results;
}

/**
 * Memory less consumption of a file line
 */
async function getRandomLine(filename){
    const rl = readline.createInterface({
        input: fs.createReadStream(filename),
        crlfDelay: Infinity
    });

    let linesCount = 0;
    for await (const line of rl) {
        linesCount += 1;
    }

    rl.close();

    const rl1 = readline.createInterface({
        input: fs.createReadStream(filename),
        crlfDelay: Infinity
    });

    const wantLine = Math.floor(Math.random() * linesCount);

    let gotLine = 0;
    let myLine = undefined;
    rl1.on('line', (line) => {
        if (gotLine === wantLine) {
            myLine = line
        }
        gotLine += 1;
    });

    let currentLine = 0;
    for await (const line of rl1) {
        if (wantLine === currentLine) {
            rl1.close();
        }

        currentLine += 1;
    }

    return myLine.trim();
}

function getRedirectLocation(url) {
    // return a promise
    return new Promise((resolve) => {
        const req = https.request(url, (res) => {
            let body = '';

            res.on('data', (chunk) => {
                body += chunk;
            })
            res.on('end', () => {
                resolve(res.headers.location || undefined);
            })
            res.on('error', function(e) {
                console.log('location redirect check issue');
                resolve(undefined);
            });
        })
        req.end();
    });
}

let urls = undefined;

function getChannels() {
    return new Promise(function (myResolve, myReject) {
        request(bundleUrl, {json: true}, (err, res, body) => {
            if (err) {
                myReject();
                console.log(err)
                return;
            }

            console.log('channels loaded')

            const urls = [];
            body.forEach((line, index) => {
                if (line.group.toLowerCase() !== 'germany') {
                    return;
                }

                urls.push({
                    id: index,
                    url: line.url,
                    name: line.name
                })
            });

            myResolve(urls)
        });
    });
}

function getQueryAuthParameter(signature) {
    return {
        n: 1,
        b: 5,
        vavoo_auth: signature,
    };
}

async function getSignature() {
    const CACHE_KEY = 'vavoo_signature';

    const value = cache.get(CACHE_KEY);
    if (value !== undefined) {
        return value;
    }

    return new Promise(async function (myResolve, myReject) {
        const vavooVec = await getRandomLine(__dirname + '/vavookeys');

        request.post({
            url: vavooPingUrl,
            body: {"vec": vavooVec},
            json: true
        }, (err, res, body) => {
            if (err) {
                console.log('vavoo_signature ping error: ', err);
                myReject();
                return;
            }

            if (!body?.response?.signed) {
                console.log('vavoo_signature unknown response: ' + JSON.stringify(body));
                myReject();
            }

            const signed = body.response.signed;

            // trust ping for re-auth e.g. 5min, but reduce it a bit
            const nextPing = body?.response?.nextPing || (60 * 5 * 1000);
            const ourNextPing = Math.round(nextPing / 1000 * 0.98);

            console.log(`new vavoo_signature signature: next ping in ${(ourNextPing / 60).toFixed(1)} minutes`);
            cache.set(CACHE_KEY, signed, ourNextPing);

            myResolve(signed)
        });
    });
}

app.get('/channels.m3u8', async function (req, res) {
    const output = ["#EXTM3U"];

    const myUrls = urls ? urls : urls = await getChannels();

    for (let channel of myUrls) {
        output.push(`#EXTINF:-1 tvg-name="${channel.name}" group-title="Sky" tvg-logo="${channel.logo ? channel.name : ''}" tvg-id="${channel.name}",${channel.name}`)
        output.push('#EXTVLCOPT:http-user-agent=VAVOO/2.6')
        output.push(`${req.protocol}://${req.headers.host}/stream/${channel.id}`)
    }

    res.send(output.join("\n"));
});

app.get('/channels.bouquet', async function (req, res) {
    const output = ["#NAME iptv - All Channels"];

    const myUrls = urls ? urls : urls = await getChannels();

    for (let channel of myUrls) {
        const url = encodeURIComponent(`${req.protocol}://${req.headers.host}/stream/${channel.id}`);
        output.push(`#SERVICE 1:0:1:0:0:0:0:0:0:0:${url}#sapp_tvgid=${channel.name}&User-Agent=VAVOO/2.6:${channel.name}`);
        output.push(`#DESCRIPTION ${channel.name}`)
    }

    res.send(output.join("\n"));
});

app.get('/stream/:id', async function (req, res) {
    const connId = `${req.socket.remoteAddress}`;
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    console.log(`[${connId}] connection opened: "${userAgent}"`);

    const id = req.params.id;

    const myUrls = urls ? urls : urls = await getChannels();

    let channel = myUrls.find(z => z.id.toString() === id.toString());
    if (!channel) {
        res.status(400);
        res.send(`[${connId}] unknown channel: ${channel}`);
        return;
    }

    if (userAgent.toLowerCase().includes('vavoo')) {
        const searchParams = new URLSearchParams(getQueryAuthParameter(await getSignature()));

        const redirectUrl = channel.url + '?' + searchParams.toString();
        console.log(`[${connId}] user-agent valid "${userAgent}" "${channel.name}" redirecting: ${redirectUrl}`);

        // first call is a redirect and attached to the client IP, doing this allows open it without IP check.
        const redirectLocation = await getRedirectLocation(redirectUrl);
        if (redirectLocation) {
            console.log(`[${connId}] user-agent valid "${userAgent}" "${channel.name}" found another redirect: ${redirectLocation}`);

            res.redirect(redirectLocation);
            return;
        }

        res.redirect(redirectUrl);
        return;
    }

    const st = request({
        qs: getQueryAuthParameter(await getSignature()),
        uri: channel.url,
        headers: {
            "User-Agent": "VAVOO/2.6",
        }
    }, function (error, response, body) {
        if (error) {
            if (error.code === 'ECONNRESET') {
                console.log(`[${connId}] stream ended "${channel.name}"`)
            } else {
                console.log(`[${connId}] stream error`, error.message);

                res.status(400);
                res.send(`stream error: ${error.message}`);
            }
        }
    });

    req.socket.on('close', function () {
        console.log(`[${connId}] connection closed`);
        st.abort();
    });

    console.log(`[${connId}] starting stream proxy "${channel.name}"`);
    req.pipe(st).pipe(res);
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});
