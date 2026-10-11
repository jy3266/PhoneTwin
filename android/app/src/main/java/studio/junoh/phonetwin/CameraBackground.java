package studio.junoh.phonetwin;

import android.opengl.GLES20;
import android.opengl.GLES11Ext;
import com.google.ar.core.Frame;
import com.google.ar.core.Coordinates2d;
import java.nio.*;

final class CameraBackground {
    private int texture,program;
    private final FloatBuffer vertices=buffer(new float[]{-1,-1,1,-1,-1,1,1,1});
    private final FloatBuffer uv=buffer(new float[8]);
    private static FloatBuffer buffer(float[] v){FloatBuffer b=ByteBuffer.allocateDirect(v.length*4).order(ByteOrder.nativeOrder()).asFloatBuffer();b.put(v).position(0);return b;}
    private int shader(int type,String source){
        int s=GLES20.glCreateShader(type);GLES20.glShaderSource(s,source);GLES20.glCompileShader(s);
        int[] ok=new int[1];GLES20.glGetShaderiv(s,GLES20.GL_COMPILE_STATUS,ok,0);
        if(ok[0]==0)throw new IllegalStateException(GLES20.glGetShaderInfoLog(s));return s;
    }
    void create(){
        int[] t=new int[1];GLES20.glGenTextures(1,t,0);texture=t[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE);
        program=GLES20.glCreateProgram();
        GLES20.glAttachShader(program,shader(GLES20.GL_VERTEX_SHADER,"attribute vec2 p;attribute vec2 uv;varying vec2 v;void main(){gl_Position=vec4(p,0.,1.);v=uv;}"));
        GLES20.glAttachShader(program,shader(GLES20.GL_FRAGMENT_SHADER,"#extension GL_OES_EGL_image_external : require\nprecision mediump float;uniform samplerExternalOES tex;varying vec2 v;void main(){gl_FragColor=texture2D(tex,v);}"));
        GLES20.glLinkProgram(program);
        int[] ok=new int[1];GLES20.glGetProgramiv(program,GLES20.GL_LINK_STATUS,ok,0);
        if(ok[0]==0)throw new IllegalStateException(GLES20.glGetProgramInfoLog(program));
    }
    int texture(){return texture;}
    void draw(Frame frame){
        if(frame.getTimestamp()==0)return;
        vertices.position(0);uv.position(0);
        frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,vertices,Coordinates2d.TEXTURE_NORMALIZED,uv);
        vertices.position(0);uv.position(0);
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);GLES20.glUseProgram(program);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,texture);
        GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"tex"),0);
        int p=GLES20.glGetAttribLocation(program,"p"),u=GLES20.glGetAttribLocation(program,"uv");
        GLES20.glEnableVertexAttribArray(p);GLES20.glEnableVertexAttribArray(u);
        GLES20.glVertexAttribPointer(p,2,GLES20.GL_FLOAT,false,0,vertices);
        GLES20.glVertexAttribPointer(u,2,GLES20.GL_FLOAT,false,0,uv);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4);
        GLES20.glDisableVertexAttribArray(p);GLES20.glDisableVertexAttribArray(u);
    }
}
