/* 
Copyright 2018 615283 (James Conway), 2019-2020 synapses

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

'use strict';

const RoonApi = require('node-roon-api'),
    RoonApiTransport = require('node-roon-api-transport'),
    DiscordRPC = require('discord-rpc');

let _core, _transport, _rpc;
let reconnectionTimer, discordConnected = false, roonConnected = false, lastSentStatus = 0;

const settings = require('./config.json');

function scheduleReconnection() {
    clearTimeout(reconnectionTimer);
    reconnectionTimer = setTimeout(connectToDiscord, 5 * 1000);
}

async function connectToDiscord() {
    console.log("Connecting to Discord...");

    if (_rpc && _rpc.transport.socket && _rpc.transport.socket.readyState === 1) {
        await _rpc.destroy();
    }

    _rpc = new DiscordRPC.Client({ transport: 'ipc' });

    _rpc.on('ready', () => {
        console.log(`Authed for user: ${_rpc.user.username}`);

        discordConnected = true;
        clearTimeout(reconnectionTimer);

        if (!roonConnected) {
            console.log("Connecting to Roon...");

            if (settings.app.use_discovery) {
                roon.start_discovery();
            } else {
                roon.ws_connect({
                    host: settings.core_ip,
                    port: "9100"
                });
            }

            roonConnected = true;
        }
    });

    _rpc.transport.once('close', () => {
        console.log("Disconnected from discord...");
        discordConnected = false;

        scheduleReconnection();
    });

    // (syn): catching connection error is _not_ sufficient, exception is swallowed downstream
    try {
        // (syn): by sending `scopes`, the client constantly prompts for auth.
        // seems to work fine without it.
        await _rpc.login({ clientId: settings.discord.clientId });
    } catch (e) {
        console.error(e);

        scheduleReconnection();
    }
}

function setStatusForZone(zone) {
    if (!discordConnected) return;

    if (zone.state === 'stopped') {
        setActivityStopped();
    } else if (zone.state === 'paused') {
        setActivityPaused(zone.now_playing.two_line.line1, zone.now_playing.two_line.line2, zone.display_name);
    } else if (zone.state === 'loading') {
        setActivityLoading(zone.display_name);
    } else if (zone.state === 'playing') {
        setActivity(zone.now_playing.two_line.line1, zone.now_playing.two_line.line2, zone.now_playing.length, zone.now_playing.seek_position, zone.display_name);
    }
}

async function setActivity(line1, line2, songLength, currentSeek, zoneName) {
    const startTimestamp = Math.round((new Date().getTime() / 1000) - currentSeek);
    const endTimestamp = Math.round(startTimestamp + songLength);

    // rate limit a bit...
    if (Date.now() - lastSentStatus < 1000 * 10) {
        return;
    } else {
        lastSentStatus = Date.now();
    }

    _rpc.setActivity({
        details: line1.substring(0, 128),
        state: line2.substring(0, 128),
        startTimestamp,
        endTimestamp,
        largeImageKey: 'roon-main',
        largeImageText: `Zone: ${zoneName}`,
        smallImageKey: 'play-symbol',
        smallImageText: 'Roon',
        instance: false,
    });

}

async function setActivityLoading(zoneName) {
    _rpc.setActivity({
        details: 'Loading...',
        largeImageKey: 'roon-main',
        largeImageText: `Zone: ${zoneName}`,
        smallImageKey: 'roon-small',
        smallImageText: 'Roon',
        instance: false
    });
}

async function setActivityPaused(line1, line2, zoneName) {
    _rpc.clearActivity();
}

async function setActivityStopped() {
    _rpc.clearActivity();
}

DiscordRPC.register(settings.discord.clientId);

if (settings.app.auto_shutdown) {
    setTimeout(() => {
        process.exit(0);
    }, 1000 * 60 * 30);
}

const roon = new RoonApi({
    extension_id: 'moe.tdr.roon-discord-rp',
    display_name: 'Discord Rich Presence',
    display_version: '1.0',
    publisher: 'William Teder',
    email: 'twitter@williamtdr',
    website: 'https://tdr.moe',

    core_paired: core => {
        _core = core;
        _transport = _core.services.RoonApiTransport;

        let activeZone = null
        _transport.subscribe_zones((cmd, data) => {
            if (settings.zone_id) {
                activeZone = _transport._zones[settings.zone_id];
            }

            // We have no zone, set it to the latest "playing"
            // zone.
            if (activeZone === null) {
                for (const zoneID of Object.keys(_transport._zones)) {
                    const zone = _transport._zones[zoneID]
                    if (zone.state === 'playing') {
                        activeZone = zone
                        break
                    }
                }

                if (activeZone === null) {
                    console.warn("Failed to find an active zone")
                    return
                }

                console.log("Active zone changed:", activeZone.zone_id, activeZone.display_name)
            }

            if (cmd === 'Changed') {
                if (data.zones_removed) {
                    setActivityStopped();
                } else {
                    setStatusForZone(_transport._zones[activeZone.zone_id]);
                }
            }

            if (activeZone.state !== 'playing') {
                console.log("Active zone stopped, resetting")
                activeZone = null
            }
        });
    },

    core_unpaired: core => {
        _core = undefined;
        _transport = undefined;
        roonConnected = false;
    }
});

roon.init_services({
    required_services: [RoonApiTransport]
});

connectToDiscord();
