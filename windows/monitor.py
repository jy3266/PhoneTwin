"""Native Tk desktop monitor. Network runs on a separate asyncio thread."""
import asyncio
from collections import deque
import math
import queue
import secrets
import socket
import threading
import time
import tkinter as tk
from tkinter import messagebox
from relay import Relay

BG, PANEL, GRID, TEXT, MUTED, ACCENT, RED = '#0b111b', '#121d2b', '#253447', '#eef5fa', '#95a7bc', '#52e0b4', '#ff7b7b'


class Monitor:
    def __init__(self):
        self.root = tk.Tk(); self.root.title('Phone Twin • 공간 위치 모니터')
        self.root.geometry('1080x740'); self.root.minsize(880,650); self.root.configure(bg=BG)
        self.root.option_add('*Font', ('Malgun Gothic', 10))
        self.key = secrets.token_hex(4)
        self.queue = queue.Queue(maxsize=2)
        self.relay = self.loop = self.thread = None
        self.trail = deque(maxlen=600); self.previous_frame = None
        self.state = None; self.last_rate_time=time.monotonic(); self.last_count=0; self.rate=0
        self.make_ui()
        self.root.protocol('WM_DELETE_WINDOW', self.close)
        self.root.after(50,self.refresh)

    def label(self, parent, text, size=10, color=TEXT, **kw):
        return tk.Label(parent,text=text,bg=parent['bg'],fg=color,font=('Malgun Gothic',size),**kw)

    def button(self,parent,text,fn):
        return tk.Button(parent,text=text,command=fn,bg=GRID,fg=TEXT,activebackground=ACCENT,
                         relief='flat',padx=16,pady=9,cursor='hand2')

    def entry(self,parent,value,width=14):
        e=tk.Entry(parent,bg=BG,fg=TEXT,insertbackground=TEXT,relief='flat',width=width);e.insert(0,value);return e

    def make_ui(self):
        header=tk.Frame(self.root,bg=BG);header.pack(fill='x',padx=26,pady=(22,14))
        self.label(header,'PHONE TWIN',24).pack(side='left')
        self.label(header,'ANDROID → WINDOWS → UNREAL',10,MUTED).pack(side='right')
        content=tk.Frame(self.root,bg=BG);content.pack(fill='both',expand=True,padx=26)
        left=tk.Frame(content,bg=PANEL,width=290);left.pack(side='left',fill='y',padx=(0,16));left.pack_propagate(False)
        self.label(left,'연결 설정',15).pack(anchor='w',padx=18,pady=(18,12))
        ips=[]
        try:
            ips=sorted(set(v[4][0] for v in socket.getaddrinfo(socket.gethostname(),None,socket.AF_INET)))
        except OSError: pass
        self.label(left,'PC IPv4 후보',10,MUTED).pack(anchor='w',padx=18)
        self.label(left,'\n'.join(ips) or 'ipconfig에서 IPv4 확인',11,wraplength=250,justify='left').pack(anchor='w',padx=18,pady=(3,12))
        self.label(left,'휴대폰 연결 코드',10,MUTED).pack(anchor='w',padx=18)
        self.label(left,self.key,22,ACCENT).pack(anchor='w',padx=18,pady=(2,14))
        self.label(left,'휴대폰 WebSocket 포트: 8765',10,MUTED).pack(anchor='w',padx=18)
        self.label(left,'언리얼 OSC IP / 포트',10,MUTED).pack(anchor='w',padx=18,pady=(16,5))
        row=tk.Frame(left,bg=PANEL);row.pack(anchor='w',padx=18)
        self.osc_ip=self.entry(row,'127.0.0.1',16);self.osc_ip.pack(side='left',ipady=7)
        self.osc_port=self.entry(row,'9000',6);self.osc_port.pack(side='left',padx=(6,0),ipady=7)
        self.label(left,'공간 폭(Y) / 깊이(X), m',10,MUTED).pack(anchor='w',padx=18,pady=(18,5))
        row=tk.Frame(left,bg=PANEL);row.pack(anchor='w',padx=18)
        self.room_w=self.entry(row,'4.0',9);self.room_w.pack(side='left',ipady=7)
        self.room_d=self.entry(row,'4.1',9);self.room_d.pack(side='left',padx=(8,0),ipady=7)
        self.start_button=self.button(left,'서버 시작',self.start);self.start_button.pack(fill='x',padx=18,pady=(22,8))
        self.stop_button=self.button(left,'서버 중지',self.stop);self.stop_button.pack(fill='x',padx=18,pady=(0,8))
        self.button(left,'이동 경로 지우기',self.trail.clear).pack(fill='x',padx=18)
        self.label(left,'OSC  /phone/pose\n단위 cm · 수신값 10개\n\n원점은 휴대폰에서 설정합니다.\n영상은 전송하지 않습니다.',10,MUTED,justify='left').pack(anchor='w',padx=18,pady=18)
        right=tk.Frame(content,bg=BG);right.pack(side='left',fill='both',expand=True)
        cards=tk.Frame(right,bg=BG);cards.pack(fill='x',pady=(0,14));self.cards=[]
        for name in ['X / 전방','Y / 오른쪽','Z / 높이']:
            card=tk.Frame(cards,bg=PANEL);card.pack(side='left',fill='x',expand=True,padx=(0,6))
            self.label(card,name,10,MUTED).pack(anchor='w',padx=12,pady=(10,3))
            v=self.label(card,'— m',22);v.pack(anchor='w',padx=12,pady=(0,10));self.cards.append(v)
        self.canvas=tk.Canvas(right,bg=PANEL,highlightthickness=0);self.canvas.pack(fill='both',expand=True)
        self.detail=self.label(right,'휴대폰 연결 대기',11,MUTED,anchor='w');self.detail.pack(fill='x',pady=10)
        self.status=self.label(self.root,'서버를 시작한 뒤 휴대폰에 PC IPv4와 연결 코드를 입력하세요.',10,MUTED,anchor='w')
        self.status.pack(fill='x',padx=26,pady=(10,18))

    def publish(self,state):
        while True:
            try:self.queue.put_nowait(state);break
            except queue.Full:
                try:self.queue.get_nowait()
                except queue.Empty:pass

    def start(self):
        if self.thread and self.thread.is_alive():return
        try:
            port=int(self.osc_port.get());socket.inet_aton(self.osc_ip.get())
            if not 1<=port<=65535:raise ValueError()
        except (ValueError,OSError):messagebox.showerror('설정 오류','유효한 OSC IPv4와 포트를 입력하세요.');return
        self.start_button.configure(state='disabled');self.osc_ip.configure(state='disabled');self.osc_port.configure(state='disabled')
        self.status.configure(text='서버 시작 중…')
        self.last_count=0;self.rate=0;self.last_rate_time=time.monotonic()
        # Capture Tk input on UI thread; network worker must not read Tk widgets.
        ip=self.osc_ip.get()
        def safe_worker():
            self.loop=asyncio.new_event_loop();asyncio.set_event_loop(self.loop)
            self.relay=Relay(self.key,self.publish,osc_host=ip,osc_port=port)
            try:self.loop.run_until_complete(self.relay.run())
            except Exception as e:self.publish({'error':str(e)})
            finally:self.loop.close();self.publish({'stopped':True})
        self.thread=threading.Thread(target=safe_worker,daemon=True);self.thread.start()

    def stop(self):
        if self.loop and self.relay and self.loop.is_running():self.loop.call_soon_threadsafe(self.relay.stop)

    def close(self):
        self.stop();self.root.destroy()

    def refresh(self):
        try:
            while True:
                s=self.queue.get_nowait()
                if 'error' in s:self.status.configure(text='서버 오류: '+s['error'],fg=RED)
                elif s.get('stopped'):
                    self.start_button.configure(state='normal');self.osc_ip.configure(state='normal');self.osc_port.configure(state='normal')
                    if self.state:self.state=dict(self.state,valid=False,reason='STOPPED')
                else:
                    self.state=s
                    if s.get('server_ready'):self.status.configure(text='서버 실행 중 · TCP 8765 → OSC UDP '+self.osc_ip.get()+':'+self.osc_port.get(),fg=ACCENT)
                    identity=(s['session'],s['epoch'])
                    if self.previous_frame!=identity:self.trail.clear();self.previous_frame=identity
                    if s['valid'] and (not self.trail or s['p']!=self.trail[-1]):self.trail.append(s['p'])
                    now=time.monotonic()
                    if now-self.last_rate_time>=1:
                        self.rate=(s['received']-self.last_count)/(now-self.last_rate_time);self.last_count=s['received'];self.last_rate_time=now
        except queue.Empty:pass
        if self.state:
            s=self.state
            for label,v in zip(self.cards,s['p']):label.configure(text=f'{v:+.2f} m',fg=TEXT if s['valid'] else MUTED)
            self.detail.configure(text=f'{"● TRACKING" if s["valid"] else "○ "+s["reason"]}   |   {self.rate:.0f} Hz   |   최근 수신 {s["age_ms"]} ms 전',fg=ACCENT if s['valid'] else RED)
        self.draw();self.root.after(33,self.refresh)

    def draw(self):
        c=self.canvas;c.delete('all');w,h=c.winfo_width(),c.winfo_height()
        try:
            rw,rd=float(self.room_w.get()),float(self.room_d.get())
            if not math.isfinite(rw+rd) or not .2<rw<=30 or not .2<rd<=30:raise ValueError()
        except ValueError:rw,rd=4.,4.1
        scale=max(1,min((w-90)/rw,(h-80)/rd));left=(w-rw*scale)/2;bottom=(h+rd*scale)/2
        def pt(p):return left+p[1]*scale,bottom-p[0]*scale
        for k in range(int(rw*2)+1):
            x=left+k*.5*scale;c.create_line(x,bottom,x,bottom-rd*scale,fill=GRID)
        for k in range(int(rd*2)+1):
            y=bottom-k*.5*scale;c.create_line(left,y,left+rw*scale,y,fill=GRID)
        c.create_rectangle(left,bottom-rd*scale,left+rw*scale,bottom,outline=MUTED)
        c.create_text(left,bottom+20,text='O (0,0)',fill=MUTED,anchor='w')
        c.create_text(left+rw*scale,bottom+20,text='+Y 오른쪽 →',fill=MUTED,anchor='e')
        c.create_text(left,bottom-rd*scale-18,text='↑ +X 전방',fill=MUTED,anchor='w')
        points=[v for p in self.trail for v in pt(p)]
        if len(points)>=4:c.create_line(*points,fill='#287b70',width=2)
        if self.state:
            x,y=pt(self.state['p']);f=self.state['forward'];color=ACCENT if self.state['valid'] else RED
            c.create_oval(x-8,y-8,x+8,y+8,fill=color,outline='')
            c.create_line(x,y,x+f[1]*32,y-f[0]*32,fill=color,width=3,arrow='last')
            c.create_text(x+13,y-17,text='PHONE',fill=color,anchor='w')

    def run(self):self.root.mainloop()


if __name__=='__main__':Monitor().run()
