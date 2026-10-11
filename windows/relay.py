import asyncio
import hmac
import json
import socket
import time
from urllib.parse import urlsplit, parse_qs
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from protocol import decode, empty_pose, osc_pose


class Relay:
    def __init__(self, key, publish=lambda state: None, host='0.0.0.0', port=8765,
                 osc_host='127.0.0.1', osc_port=9000):
        self.key, self.publish = key, publish
        self.host, self.port = host, port
        self.osc_target = (osc_host, osc_port)
        self.pose = empty_pose()
        self.phone = None
        self.viewers = set()
        self.last_rx = -1e10
        self.counter = 0
        self.lag_ms = 0.
        self.offset = None
        self.last_seq = -1
        self.session = None
        self.server = None
        self.transport = None
        self.stopped = asyncio.Event()

    async def handler(self, ws):
        request = urlsplit(ws.request.path)
        supplied = parse_qs(request.query).get('key', [''])[0]
        if not hmac.compare_digest(supplied.encode('utf-8'), self.key.encode('utf-8')):
            await ws.close(1008, 'Wrong pairing code'); return
        if request.path == '/viewer':
            self.viewers.add(ws)
            try:
                async for _ in ws:
                    pass
            except ConnectionClosed:
                pass
            finally:
                self.viewers.discard(ws)
            return
        if request.path != '/phone':
            await ws.close(1008, 'Use /phone or /viewer'); return
        if self.phone is not None:
            await ws.close(1008, 'One phone at a time'); return
        self.phone = ws
        self.last_seq, self.session, self.offset = -1, None, None
        try:
            async for raw in ws:
                try:
                    d = decode(raw)
                except (ValueError, TypeError, KeyError):
                    await ws.close(1008, 'Invalid pose'); break
                if self.session is None:
                    self.session = d['session']
                if d['session'] != self.session or d['seq'] <= self.last_seq:
                    continue
                self.last_seq = d['seq']
                now = time.monotonic()
                offset = now - d['t_ns']/1e9
                self.offset = offset if self.offset is None else min(self.offset, offset)
                self.lag_ms = max(0., (offset-self.offset)*1000)
                # Relative excess delay, not a measured absolute one-way latency.
                if self.lag_ms > 300:
                    d['valid'] = False; d['reason'] = 'NETWORK_BACKLOG'
                self.pose, self.last_rx = d, now
                self.counter += 1
        except ConnectionClosed:
            pass
        finally:
            if self.phone is ws:
                self.phone = None
                self.pose = dict(self.pose, valid=False, reason='DISCONNECTED')

    def snapshot(self):
        age = time.monotonic()-self.last_rx
        valid = self.phone is not None and age <= .30 and self.pose['valid']
        result = dict(self.pose, valid=valid)
        if age > .30:
            result['reason'] = 'STALE' if self.counter else 'WAITING'
        result.update(connected=self.phone is not None, age_ms=round(min(age*1000, 999999)),
                      extra_delay_ms=round(self.lag_ms), received=self.counter,
                      server_ready=self.server is not None)
        return result

    async def tick(self):
        while not self.stopped.is_set():
            state = self.snapshot()
            try:
                self.transport.sendto(osc_pose(state, state['valid']), self.osc_target)
            except (OSError, ValueError):
                state['osc_error'] = True
            self.publish(state)
            if self.viewers:
                payload = json.dumps(state, allow_nan=False)
                async def send_one(ws):
                    try:
                        await asyncio.wait_for(ws.send(payload), .05)
                    except (ConnectionClosed, TimeoutError):
                        await ws.close(1013, 'Viewer too slow')
                await asyncio.gather(*(send_one(ws) for ws in list(self.viewers)))
            try:
                await asyncio.wait_for(self.stopped.wait(), 1/30)
            except TimeoutError:
                pass

    async def run(self):
        self.transport = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.transport.setblocking(False)
        try:
            async with serve(self.handler, self.host, self.port, max_size=4096, max_queue=2,
                             compression=None, ping_interval=10, ping_timeout=10) as self.server:
                self.publish(dict(self.snapshot(), server_ready=True))
                await self.tick()
                self.transport.sendto(osc_pose(self.pose, False), self.osc_target)
        finally:
            self.transport.close()

    def stop(self):
        self.stopped.set()
