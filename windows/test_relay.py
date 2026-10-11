import asyncio
import json
import math
import socket
import struct
import time
import unittest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed
from protocol import decode, osc_pose, empty_pose
from relay import Relay

def message(seq=1,valid=True):
    return dict(v=1,type='pose',session='test',epoch=1,seq=seq,t_ns=time.monotonic_ns(),
                valid=valid,reason='TEST',p=[1.25,-.5,1.2],forward=[1,0,0],up=[0,0,1])

def unpack_osc(raw):
    address=raw.split(b'\0',1)[0];offset=(len(address)+4)//4*4
    types=raw[offset:].split(b'\0',1)[0];offset+=(len(types)+4)//4*4
    assert address==b'/phone/pose' and types==b',ffffffffff'
    return struct.unpack('>10f',raw[offset:])

class ProtocolTests(unittest.TestCase):
    def test_mapping(self):
        values=unpack_osc(osc_pose(decode(json.dumps(message())),True))
        self.assertEqual(values[:4],(125.,-50.,120.,1.))
    def test_reject_nan(self):
        m=message();m['p'][0]=float('nan')
        with self.assertRaises(ValueError):decode(json.dumps(m))
    def test_reject_basis(self):
        m=message();m['up']=[1,0,0]
        with self.assertRaises(ValueError):decode(json.dumps(m))

class NetworkTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.udp=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);self.udp.bind(('127.0.0.1',0));self.udp.setblocking(False)
        self.relay=Relay('test-key',host='127.0.0.1',port=0,osc_port=self.udp.getsockname()[1])
        self.task=asyncio.create_task(self.relay.run())
        for _ in range(100):
            if self.relay.server:break
            await asyncio.sleep(.01)
        self.url=f'ws://127.0.0.1:{self.relay.server.sockets[0].getsockname()[1]}'
    async def asyncTearDown(self):
        self.relay.stop();await asyncio.wait_for(self.task,3);self.udp.close()
    async def get_udp(self,predicate):
        loop=asyncio.get_running_loop()
        for _ in range(80):
            raw=await asyncio.wait_for(loop.sock_recv(self.udp,1024),1)
            v=unpack_osc(raw)
            if predicate(v):return v
        self.fail('OSC condition not received')
    async def test_ws_to_osc_and_viewer_and_stale(self):
        async with connect(self.url+'/phone?key=test-key') as phone, connect(self.url+'/viewer?key=test-key') as viewer:
            await phone.send(json.dumps(message()))
            v=await self.get_udp(lambda v:v[3]==1)
            self.assertEqual(v[:3],(125.,-50.,120.))
            while True:
                m=json.loads(await asyncio.wait_for(viewer.recv(),1))
                if m['valid']:break
            self.assertEqual(m['p'],[1.25,-.5,1.2])
            await asyncio.sleep(.35)
            await self.get_udp(lambda v:v[3]==0)
    async def test_auth(self):
        async with connect(self.url+'/phone?key=wrong') as ws:
            with self.assertRaises(ConnectionClosed):await ws.recv()
            self.assertEqual(ws.close_code,1008)
    async def test_single_phone_and_invalid_and_old_seq(self):
        async with connect(self.url+'/phone?key=test-key') as phone:
            async with connect(self.url+'/phone?key=test-key') as second:
                with self.assertRaises(ConnectionClosed):await second.recv()
            await phone.send(json.dumps(message(2,True)));await self.get_udp(lambda v:v[3]==1)
            old=message(1);old['p']=[9,9,9];await phone.send(json.dumps(old));await asyncio.sleep(.03)
            self.assertEqual(self.relay.pose['seq'],2)
            await phone.send(json.dumps(message(3,False)));await self.get_udp(lambda v:v[3]==0)

if __name__=='__main__':unittest.main(verbosity=2)
