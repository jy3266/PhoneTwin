package studio.junoh.phonetwin;

import java.util.concurrent.TimeUnit;
import okhttp3.*;

/** Latest frames only; never save or replay a motion backlog. */
public final class SocketSender extends WebSocketListener {
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(4,TimeUnit.SECONDS).readTimeout(0,TimeUnit.MILLISECONDS)
        .pingInterval(10,TimeUnit.SECONDS).build();
    private WebSocket socket;
    private boolean enabled=false, open=false;
    private String url="";
    private long retryAt=0;
    public volatile String status="연결 전";

    public synchronized void start(String host,String code) {
        stop();
        HttpUrl u=new HttpUrl.Builder().scheme("http").host(host.trim()).port(8765)
            .addPathSegment("phone").addQueryParameter("key",code.trim()).build();
        url=u.toString().replaceFirst("^http:","ws:"); enabled=true;retryAt=0;
        tick();
    }
    public synchronized void tick() {
        if(!enabled||socket!=null||System.currentTimeMillis()<retryAt)return;
        status="연결 중";
        socket=client.newWebSocket(new Request.Builder().url(url).build(),this);
    }
    public synchronized void send(String message) {
        if(!enabled||!open||socket==null)return;
        if(socket.queueSize()>8192){reset("네트워크 지연 · 재연결");return;}
        if(!socket.send(message))reset("송신 중단 · 재연결");
    }
    private void reset(String message){
        if(socket!=null)socket.cancel();socket=null;open=false;status=message;
        retryAt=System.currentTimeMillis()+2000;
    }
    public synchronized void stop(){enabled=false;reset("연결 중지");}
    public void shutdown(){stop();client.dispatcher().executorService().shutdown();client.connectionPool().evictAll();}
    @Override public synchronized void onOpen(WebSocket ws,Response response){
        if(ws!=socket){ws.cancel();return;}open=true;status="Windows 연결됨";
    }
    @Override public synchronized void onFailure(WebSocket ws,Throwable t,Response response){
        if(ws==socket)reset("연결 실패 · IP/코드/방화벽 확인");
    }
    @Override public synchronized void onClosing(WebSocket ws,int code,String reason){
        ws.close(code,reason);if(ws==socket)reset("연결 종료 · 코드/다른 휴대폰 확인");
    }
}
