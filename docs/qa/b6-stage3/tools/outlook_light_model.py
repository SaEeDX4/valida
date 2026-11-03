import math
def hx(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
def lin(v): return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
def gam(v): v=max(0,min(1,v)); return 12.92*v if v<=0.0031308 else 1.055*v**(1/2.4)-0.055
M=[[0.4124564,0.3575761,0.1804375],[0.2126729,0.7151522,0.0721750],[0.0193339,0.1191920,0.9503041]]
Mi=[[3.2404542,-1.5371385,-0.4985314],[-0.9692660,1.8760108,0.0415560],[0.0556434,-0.2040259,1.0572252]]
W=(0.95047,1.0,1.08883)
f=lambda t: t**(1/3) if t>216/24389 else (24389/27*t+16)/116
fi=lambda t: t**3 if t**3>216/24389 else (116*t-16)/(24389/27)
def lab(h):
    r,g,b=(lin(x) for x in hx(h)); X,Y,Z=(sum(M[i][j]*c for j,c in enumerate((r,g,b))) for i in range(3))
    fx,fy,fz=f(X/W[0]),f(Y/W[1]),f(Z/W[2]); return 116*fy-16,500*(fx-fy),200*(fy-fz)
def rgb(L,a,b):
    fy=(L+16)/116; fx=fy+a/500; fz=fy-b/200; X,Y,Z=fi(fx)*W[0],fi(fy)*W[1],fi(fz)*W[2]
    r,g,bb=(sum(Mi[i][j]*c for j,c in enumerate((X,Y,Z))) for i in range(3))
    return '#%02X%02X%02X'%tuple(round(gam(v)*255) for v in (r,g,bb))
def Y(h): r,g,b=(lin(x) for x in hx(h)); return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b): ya,yb=Y(a),Y(b); return (max(ya,yb)+0.05)/(min(ya,yb)+0.05)
s,o=lab('#66B3FF'),lab('#007CC5')
Cs,Co=math.hypot(s[1],s[2]),math.hypot(o[1],o[2]); hs,ho=math.atan2(s[2],s[1]),math.atan2(o[2],o[1])
print('66B3FF',[round(x,1) for x in s],'-> 007CC5',[round(x,1) for x in o],'C ratio %.2f dh %.1f deg'%(Co/Cs,math.degrees(ho-hs)))
n=lab('#83C6FF'); Cn=math.hypot(n[1],n[2]); hn=math.atan2(n[2],n[1])
for c in (116.7,119.3,121.1):
    L=c-n[0]; C=Cn*Co/Cs; h=hn+(ho-hs)
    col=rgb(L,C*math.cos(h),C*math.sin(h))
    print('#83C6FF pred c=%.1f L*%.1f -> %s  contrast on #E9EBEF %.2f'%(c,L,col,cr(col,'#E9EBEF')))
for c in (116.7,119.3,121.1):
    L=c-lab('#C9D1DA')[0]; g=rgb(L,0,0); print('#C9D1DA pred (neutral) c=%.1f L*%.1f ~%s contrast %.2f'%(c,L,g,cr(g,'#E9EBEF')))
