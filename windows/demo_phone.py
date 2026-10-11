import argparse
import asyncio
import json
import math
import time
import uuid
from urllib.parse import urlencode
from websockets.asyncio.client import connect

async def run(args):
    url=f'ws://{args.host}:8765/phone?'+urlencode({'key':args.key})
    session=str(uuid.uuid4());start=time.monotonic();seq=0
    async with connect(url,compression=None) as ws:
        while time.monotonic()-start<args.seconds:
            t=time.monotonic()-start;seq+=1
            message=dict(v=1,type='pose',session=session,epoch=1,seq=seq,t_ns=time.monotonic_ns(),
                         valid=args.invalid_after<0 or t<args.invalid_after,reason='DEMO',
                         p=[2+math.cos(t*.5),2+math.sin(t*.5),1.2],
                         forward=[-math.sin(t*.5),math.cos(t*.5),0],up=[0,0,1])
            await ws.send(json.dumps(message));await asyncio.sleep(1/30)

if __name__=='__main__':
    p=argparse.ArgumentParser(description='Synthetic motion, not phone measurement')
    p.add_argument('--host',default='127.0.0.1');p.add_argument('--key',required=True)
    p.add_argument('--seconds',type=float,default=60);p.add_argument('--invalid-after',type=float,default=-1)
    try:asyncio.run(run(p.parse_args()))
    except KeyboardInterrupt:pass
