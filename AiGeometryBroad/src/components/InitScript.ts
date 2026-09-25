
// 初始的用户输入示例，引导用户如何使用
export const INITIAL_USER_INPUT = `# 圆内蝴蝶定理

VIEW scale=1.5
CLEAR color=black labelColor=white

CREATE SLOT name=slot_r value=150

CREATE POINT name=O x=0 y=0 radius=1 real=true
CREATE CIRCLE name=C1 center=O radius={slot_r}
CREATE POINT name=P1 x=0 y=100 radius=1 real=true
CREATE POINT name=P2 x=10 y=100 radius=1 real=true
CREATE LINE name=LAB p1=P1 p2=P2
CREATE INTERSECT name=A,B obj1=C1 obj2=LAB

CREATE SEGMENT name=AB p1=A p2=B

CREATE RANDOMPOINT name=C obj=C1 start=80 end=90
CREATE RANDOMPOINT name=D obj=C1 start=110 end=120

CREATE LINE name=L1 p1=C p2=P1
CREATE LINE name=L2 p1=D p2=P1

CREATE INTERSECT name=E,E1 obj1=L1 obj2=C1
CREATE INTERSECT name=F,F1 obj1=L2 obj2=C1

CREATE SEGMENT name=DF p1=D p2=F
CREATE SEGMENT name=CE p1=C p2=E

CREATE SEGMENT name=DE p1=D p2=E
CREATE SEGMENT name=CF p1=C p2=F

CREATE INTERSECT name=M obj1=DE obj2=LAB
CREATE INTERSECT name=N obj1=CF obj2=LAB

draw obj=C1 color=blue
draw obj=CE color=blue
draw obj=DF color=blue
draw obj=AB color=blue
draw obj=DE color=blue
draw obj=CF color=blue

draw obj=A color=red label=A
draw obj=B color=red label=B
draw obj=C color=red label=C
draw obj=D color=red label=D
draw obj=P1 color=red label=P
draw obj=E color=red label=E
draw obj=F color=red label=F
draw obj=M color=red label=M
draw obj=N color=red label=N

# 作辅助线 
CREATE PARALLEL name=LEG line=AB point=E
CREATE INTERSECT name=G obj1=LEG obj2=C1
CREATE SEGMENT name=seg_EG p1=E p2=G
draw obj=seg_EG color=blue style=dashed
draw obj=G color=red label=G

CREATE SEGMENT name=PG p1=P1 p2=G
CREATE SEGMENT name=NG p1=N p2=G
CREATE SEGMENT name=FG p1=F p2=G

draw obj=PG color=blue style=dashed
draw obj=NG color=blue style=dashed
draw obj=FG color=blue style=dashed

CREATE CIRCUMCIRCLE name=C_PNF p1=P1 p2=N p3=F
draw obj=C_PNF color=blue style=dashed
 

MEASURE type=distance slot=slot_MP p1=M p2=P1
MEASURE type=distance slot=slot_NP p1=N p2=P1

PRINT m=过E作EG平行于AB交圆于G，连接PG，NG，FG
PRINT m=显然PE=PG，∠BPE=∠APG
PRINT m=∠APG=∠BPE=(弧CA + 弧BE)/2=(弧CA + 弧AG)/2 = 弧CAG/2
PRINT m=∠NFG=弧CBG/2，所以 ∠APG+∠NFG=180，所以PNEG四点共圆
PRINT m=∠PGN=∠PFN=∠PEM，从而ΔPME≅ΔPNG，PM=PN
PRINT m=注：如果G在AF之间，就应该在另外一边作对称的辅助线
`;