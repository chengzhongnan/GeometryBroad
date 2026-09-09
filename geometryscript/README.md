### **几何作图 DSL 设计文档 (更新版)**

我们的设计目标是创建一个**明确、无歧义、易于解析且能支持复杂几何构造**的 DSL（领域特定语言）。该 DSL 允许通过简单的文本指令来描述从基础到复杂的几何图形，并最终由渲染引擎绘制出来。

我们将命令分为以下几类：

1.  **元指令 (Meta Commands)**：管理画布、状态、控制流和输出操作。
2.  **几何指令 (Geometric Commands)**：创建和操作几何对象。
3.  **动态与动画指令 (Dynamic & Animation Commands)**：允许创建动态和交互式的几何构造。

#### **语法约定**

* 指令不区分大小写（例如 `POINT` 和 `point` 等效）。
* 参数名称和变量名区分大小写（例如 `A` 和 `a` 是不同的点）。
* 所有参数均以 `key=value` 的形式提供，以增强可读性。
* 几何指令在概念上以一个操作动词 `CREATE` 作为前缀。当前的解析器将行中的第二个词作为指令（例如，在 `CREATE POINT` 中，`POINT` 是指令）。
* 数值可以通过直接量或动态计算的**插槽 (Slot)** 来提供。要使用插槽的值，请将其名称包含在花括号中，如 `{slot_name}`。支持复杂的数学表达式（例如 `{slot_A * sin(PI()/4)}`）。

---

### **1. 元指令 (Meta Commands)**

这些指令控制绘图环境、脚本执行和输出。

* `# <text>`
    * **描述**: 注释。解析器会忽略从 `#` 到行尾的所有内容。
    * **示例**: `# 定义三角形的三个顶点`

* `CLEAR [color=<color_value>]`
    * **描述**: 将整个画布清除为指定的颜色。
    * **参数**:
        * `color=<color_value>` 或 `c=<color_value>`: (可选) 用于填充画布的颜色（例如 `white`, `#FFFFFF`）。默认为 `white`。
    * **示例**: `CLEAR color=lightblue`

* `VIEW [centerX=<number>] [centerY=<number>] [scale=<number>]`
    * **描述**: 设置画布的视口，实现平移和缩放。它决定了逻辑坐标如何映射到屏幕。
    * **参数**:
        * `centerX=<number>`: (可选) 逻辑坐标系中的 X 坐标，它将被放置在画布的中心。默认为 0。
        * `centerY=<number>`: (可选) 逻辑坐标系中的 Y 坐标，它将被放置在画布的中心。默认为 0。
        * `scale=<number>`: (可选) 缩放级别。`1` 代表 1:1 映射，`2` 代表放大一倍，`0.5` 代表缩小一半。默认为 1。
    * **示例**: `VIEW centerX=400 centerY=300 scale=1.5`

* `DRAW obj=<object_name> [options...]`
    * **描述**: 在画布上绘制一个已定义的几何对象。
    * **参数**:
        * `obj=<object_name>`: 要绘制的对象的名称。可以使用插槽获取名称，例如 `obj={object_name_slot}`。
    * **可选项**:
        * `color=<color_value>`: 对象的颜色 (e.g., `red`, `#FF0000`)。
        * `width=<number>`: 线性对象的线宽。
        * `fill=<color_value>`: 闭合图形（如圆、多边形）的填充色。
        * `style=<style_value>`: 线条样式 (`solid` 或 `dashed`)。
        * `label="<text>"` 或 `l="<text>"`: 为对象添加文本标签。
        * `direction=<dir>`: 标签位置 (`up`, `down`, `left`, `right`)。默认为 `down`。
    * **示例**: `DRAW obj=seg_AB width=2 color=blue style=dashed label="线段 AB"`

* `CODE name=<block_name>`
    * **描述**: 开始一个命名代码块的定义。所有后续行，从一个只包含 `[` 的行开始，到一个只包含 `]` 的行结束，都会被添加到这个块中。
    * **参数**:
        * `name=<block_name>`: 代码块的唯一名称。
    * **示例**:
        ```
        CODE name=draw_triangle
        [
        DRAW obj=tri_ABC color=green
        DRAW obj=A color=red
        DRAW obj=B color=red
        DRAW obj=C color=red
        ]
        ```

* `RUN code=<block_name>`
    * **描述**: 执行存储在命名代码块中的指令。
    * **参数**:
        * `code=<block_name>`: 要执行的代码块的名称。
    * **示例**: `RUN code=draw_triangle`

* `WITH code=<block_name> with=<slot_name>`
    * **描述**: 有条件地执行一个代码块。仅当指定插槽中的数值不为零时，才会执行该代码块。
    * **参数**:
        * `code=<block_name>` 或 `c=<block_name>`: 代码块的名称。
        * `with=<slot_name>` 或 `w=<slot_name>`: 要检查的插槽的名称。
    * **示例**: `WITH code=do_something with=my_condition_slot`

* `MEASURE type=<type_value> ... slot=<slot_name>`
    * **描述**: 测量几何对象的属性（如距离、角度、面积）并将结果存入一个插槽 (Slot) 中。
    * **参数**:
        * `type=<type_value>` 或 `t=<type_value>`: (必须) 要测量的属性类型。可选值：`distance`, `length`, `angle`, `area`。
        * `slot=<slot_name>` 或 `s=<slot_name>`: (必须) 用于存储测量结果的插槽名称。
        * `obj=<object_name>` 或 `o=<object_name>`: (可选) 要测量的单个对象（用于线段长度、角度大小、图形面积）。
        * `p1=<point1_name>`, `p2=<point2_name>`: (可选) 当 `type=distance` 时，用于测量两点之间的距离。
    * **示例**:
        * `MEASURE type=distance p1=A p2=B slot=dist_AB`
        * `MEASURE type=area obj=tri_ABC slot=area_ABC`
        * `MEASURE type=angle obj=angle1 slot=angle_value`

* `CALCULATE expression=<expression> [slot=<slot_name>]`
    * **描述**: 执行一个数学表达式，并将结果存入指定的插槽中。
    * **参数**:
        * `expression=<expression>` 或 `e=<expression>`: (必须) 要计算的数学表达式，可以引用其他插槽，如 `{dist_AB} / 2`。
        * `slot=<slot_name>` 或 `s=<slot_name>`: (可选) 用于存储结果的插槽名称。
    * **示例**: `CALCULATE expression=sqrt({dist_AB}^2 + {dist_BC}^2) slot=hypotenuse`

* `GETOBJ name=<obj_name> property=<prop_name> slot=<slot_name>`
    * **描述**: (高级) 从一个复合对象中获取其某个作为几何对象的属性，并将该属性对象的名称存入一个插槽中。
    * **参数**:
        * `name=<obj_name>` 或 `n=<obj_name>`: (必须) 复合对象的名称。
        * `property=<prop_name>` 或 `p=<prop_name>`: (必须) 要获取的属性的名称 (例如 `p1`, `center`)。
        * `slot=<slot_name>` 或 `s=<slot_name>`: (必须) 用于存储结果（属性对象的名称）的插槽。
    * **示例**: `GETOBJ name=tri_ABC property=p1 slot=vertex1_name`

* `PRINT message=<text>`
    * **描述**: 在控制台或UI消息区打印一条消息。消息可以包含插槽中的值。
    * **参数**:
        * `message=<text>` 或 `m=<text>`: 要显示的文本。使用 `{slot}` 来替换插槽的值。
    * **示例**: `PRINT message="当前距离是 {dist_AB} 个单位。"`

* `TRANSLATE`
    * **状态**: **未实现**。

---

### **2. 几何指令 (Geometric Commands)**

这些指令用于创建、定义和修改几何对象。

#### **基础对象与定义**

* `CREATE POINT name=<text> x=<number> y=<number> [radius=<number>] [real=<boolean>]`
    * **描述**: 使用绝对坐标定义一个点。
    * **参数**:
        * `name=<text>`: 新点的唯一名称。
        * `x=<number>`: 点的 X 坐标。
        * `y=<number>`: 点的 Y 坐标。
        * `radius=<number>`: (可选) 用于渲染的点的大小（半径）。默认为 1。
        * `real=<boolean>`: (可选) 标记该点是否为“实”点。默认为 `false`。
    * **示例**: `CREATE POINT name=A x=100 y=200 radius=5`

* `CREATE LINE name=<text> p1=<text> p2=<text>`
    * **描述**: 定义一条穿过两个已知点的无限长的直线。
    * **示例**: `CREATE LINE name=l_AB p1=A p2=B`

* `CREATE SEGMENT name=<text> p1=<text> p2=<text>`
    * **描述**: 定义一条连接两个已知点的线段。
    * **示例**: `CREATE SEGMENT name=seg_AB p1=A p2=B`

* `CREATE RAY name=<text> vertex=<text> p1=<text>`
    * **描述**: 定义一条从一个点出发，穿过另一个点的射线。
    * **参数**:
        * `vertex=<text>` 或 `v=<text>`: 射线的起点名称。
        * `p1=<text>`: 射线上除起点外的另一点的名称，用于确定方向。
    * **示例**: `CREATE RAY name=ray_A_B vertex=A p1=B`

* `CREATE ANGLE name=<text> vertex=<text> p1=<text> [p2=<text> | angle=<number>] [showArc=<boolean>]`
    * **描述**: 定义一个角度。可以通过三个点定义，也可以通过两个点（顶点和一边上的一点）和一个角度值定义。
    * **参数**:
        * `vertex=<text>` 或 `v=<text>`: 角的顶点名称。
        * `p1=<text>`: 角的一条边上的点的名称。
        * `p2=<text>`: (可选) 角的另一条边上的点的名称。
        * `angle=<number>` 或 `a=<number>`: (可选) 如果未提供 `p2`，则通过此角度值（度）构建第二条边。
        * `showArc=<boolean>`: (可选) 是否绘制弧线来表示该角。默认为 `true`。
    * **示例**:
        * `CREATE ANGLE name=angle_ABC vertex=B p1=A p2=C`
        * `CREATE ANGLE name=angle_45deg vertex=O p1=P angle=45`

#### **派生构造**

* `CREATE MIDPOINT name=<text> p1=<text> p2=<text>`
    * **描述**: 定义两个给定点的中点。
    * **示例**: `CREATE MIDPOINT name=M p1=A p2=B`

* `CREATE INTERSECT name=<text> obj1=<text> obj2=<text>`
    * **描述**: 定义两个几何对象（直线、射线、线段、圆）的交点。
    * **注意**: 支持 线-线、线-圆、圆-圆 类型的相交。如果存在多个交点，请在 `name` 参数中使用逗号分隔的名称列表（例如 `name=P1,P2`）。
    * **参数**:
        * `name=<text>`: 新交点的唯一名称（或逗号分隔的名称列表）。
        * `obj1=<text>` 或 `o1=<text>`: 第一个几何对象的名称。
        * `obj2=<text>` 或 `o2=<text>`: 第二个几何对象的名称。
    * **示例**: `CREATE INTERSECT name=P,Q obj1=my_line obj2=my_circle`

* `CREATE POINT_ON_LINE name=<text> line=<text> distance=<number> point=<text>`
    * **描述**: 在一个线性对象上，根据与某参考点的距离定义一个新点。
    * **参数**:
        * `line=<text>` 或 `l=<text>`: 已定义的直线、射线或线段的名称。
        * `distance=<number>` 或 `d=<number>`: 与参考点之间的距离。
        * `point=<text>` 或 `p=<text>`: 线上的一个参考点的名称。
    * **示例**: `CREATE POINT_ON_LINE name=P3 line=l_AB distance=50 point=A`

* `CREATE RANDOMPOINT name=<text> obj=<object_name> [start=<number>] [end=<number>]`
    * **描述**: 在给定对象的边界上创建一个随机点。
    * **参数**:
        * `obj=<object_name>` 或 `o=<object_name>`: 目标对象的名称 (`Line`, `Circle`, `Ellipse` 等)。
        * `start=<number>` 或 `s=<number>`: (可选) 生成的起始边界。对于线，是比例（0到1）；对于圆/椭圆，是角度（0到360）。默认为0。
        * `end=<number>` 或 `e=<number>`: (可选) 生成的结束边界。默认为1或360。
    * **示例**: `CREATE RANDOMPOINT name=rand_p obj=my_circle start=0 end=90`

#### **几何作图**

* `CREATE PERP_BISECTOR name=<text> p1=<text> p2=<text>`
    * **描述**: (中垂线) 创建连接两点的线段的垂直平分线。
    * **示例**: `CREATE PERP_BISECTOR name=pb_AB p1=A p2=B`

* `CREATE PERPENDICULAR name=<text> point=<text> line=<text>`
    * **描述**: (垂线) 创建一条通过指定点并垂直于指定直线的垂线。
    * **参数**:
        * `point=<text>` 或 `p=<text>`: 垂线必须通过的点的名称。
        * `line=<text>` 或 `l=<text>`: 已有直线的名称。
    * **示例**: `CREATE PERPENDICULAR name=perp_l point=C line=l_AB`

* `CREATE PARALLEL name=<text> point=<text> line=<text>`
    * **描述**: (平行线) 创建一条通过指定点并平行于指定直线的平行线。
    * **示例**: `CREATE PARALLEL name=para_l point=C line=l_AB`

* `CREATE ANGLE_BISECTOR name=<text> angle=<text>`
    * **描述**: (角平分线) 创建一个已有角度的角平分线。
    * **参数**:
        * `angle=<text>` 或 `a=<text>`: 已有角度对象的名称。
    * **示例**: `CREATE ANGLE_BISECTOR name=b_ABC angle=angle_ABC`

* `CREATE TANGENT name=<text> circle=<text> point=<text>`
    * **描述**: (切线) 创建过指定点作指定圆的切线所需的点。
    * **参数**:
        * `name=<text>`: 为创建的新点指定的唯一名称（或名称列表）。
        * `circle=<text>` 或 `c=<text>`: 圆对象的名称。
        * `point=<text>` 或 `p=<text>`: 圆外或圆上一点的名称。
    * **注意**: 如果点在圆上，则创建一个点来定义切线。如果点在圆外，则创建两个切点，此时 `name` 应为逗号分隔的两个名称，如 `name=T1,T2`。
    * **示例**: `CREATE TANGENT name=T1,T2 circle=c1 point=P_outside`

#### **高级对象**

* `CREATE TRIANGLE name=<text> p1=<text> p2=<text> p3=<text>`
    * **描述**: 通过三个顶点定义一个三角形。
    * **示例**: `CREATE TRIANGLE name=tri_ABC p1=A p2=B p3=C`

* `CREATE RECTANGLE name=<text> p1=<text> width=<number> height=<number>`
    * **描述**: 通过一个角上的顶点、宽度和高度创建一个矩形。
    * **参数**:
        * `p1=<text>`: 起始角的顶点。
        * `width=<number>` 或 `w=<number>`: 矩形的宽度。
        * `height=<number>` 或 `h=<number>`: 矩形的高度。
    * **示例**: `CREATE RECTANGLE name=rect1 p1=A width=200 height=100`

* `CREATE POLYGON name=<text> points=<text_list>`
    * **描述**: 通过一系列顶点定义一个多边形。
    * **参数**:
        * `points=<text_list>` 或 `p=<text_list>`: 一个由逗号分隔的顶点名称列表。
    * **示例**: `CREATE POLYGON name=poly1 points=A,B,C,D`

* `CREATE CIRCLE name=<text> center=<text> radius=<number>`
    * **描述**: 通过圆心和半径定义一个圆。
    * **参数**:
        * `center=<text>` 或 `c=<text>`: 圆心点的名称。
        * `radius=<number>` 或 `r=<number>`: 圆的半径。
    * **示例**: `CREATE CIRCLE name=c1 center=O radius=50`

* `CREATE CIRCUMCIRCLE name=<text> p1=<text> p2=<text> p3=<text>`
    * **描述**: (外接圆) 创建通过三个点的外接圆。它同时会创建其圆心，命名为 `<circle_name>_<cumcenter>`。
    * **示例**: `CREATE CIRCUMCIRCLE name=c_circum p1=A p2=B p3=C`

* `CREATE INCIRCLE name=<text> p1=<text> p2=<text> p3=<text>`
    * **描述**: (内切圆) 创建由三个点构成的三角形的内切圆。它同时会创建其圆心，命名为 `<circle_name>_<inccenter>`。
    * **示例**: `CREATE INCIRCLE name=c_in p1=A p2=B p3=C`

* `CREATE ELLIPSE name=<text> center=<text> radiusX=<number> radiusY=<number> [rotation=<number>]`
    * **描述**: 定义一个椭圆。
    * **参数**:
        * `center=<text>` 或 `c=<text>`: 中心的点名称。
        * `radiusX=<number>` 或 `rX=<number>`: X轴方向的半径。
        * `radiusY=<number>` 或 `rY=<number>`: Y轴方向的半径。
        * `rotation=<number>` 或 `rot=<number>`: (可选) 旋转角度（度）。默认为 0。
    * **示例**: `CREATE ELLIPSE name=E1 center=P_center rX=150 rY=80 rotation=45`

* `CREATE FOCIS name=<text,text> obj=<ellipse_name>`
    * **描述**: 定义一个椭圆的两个焦点。
    * **参数**:
        * `name=<text,text>`: 用逗号分隔的两个新焦点的名称。
        * `obj=<ellipse_name>` 或 `o=<ellipse_name>`: 已有椭圆的名称。
    * **示例**: `CREATE FOCIS name=F1,F2 obj=E1`

* `PARABOLA`, `HYPERBOLA`
    * **状态**: **未实现**。

#### **变换**

* `MOVE`, `ROTATE`, `REFLECT`
    * **状态**: **未实现**。

---

### **3. 动态插槽、表达式与动画**

这些功能允许创建动态和交互式的几何图形。

* `CREATE SLOT name=<text> value=<expression>`
    * **描述**: 创建一个命名的数值变量（插槽），其值可以被计算并在其他指令中动态使用。
    * **参数**:
        * `name=<text>`: 插槽的唯一名称。
        * `value=<expression>` 或 `v=<expression>` 或 `expression=<expression>` 或 `e=<expression>`: 一个数值表达式。
    * **示例**:
        ```
        CREATE SLOT name=pos_x value=50
        CREATE POINT name=P x={pos_x} y={pos_x + 20}
        ```

* `CREATE ANIMATION name=<text> code=<block_name> slot=<slot_name> [interval=<ms>] [repeat=<boolean>]`
    * **描述**: 定义并启动一个动画。动画会周期性地执行一个代码块，并在每一帧增加一个插槽的值，从而允许几何构造随时间变化。
    * **参数**:
        * `name=<text>`: 动画的唯一名称。
        * `code=<block_name>` 或 `c=<block_name>`: 在每一帧要执行的代码块的名称。
        * `slot=<slot_name>` 或 `s=<slot_name>`: 在每一帧其值会递增的插槽的名称（从0开始）。
        * `interval=<ms>`: (可选) 每帧之间的时间间隔（毫秒）。默认为1000。
        * `repeat=<boolean>`: (可选) 动画是否循环播放。默认为 `false`。
    * **示例**:
        ```
        # 用于控制点位置的插槽
        CREATE SLOT name=anim_frame value=0
        
        # 一个位置由插槽控制的点
        CREATE POINT name=MovingPoint x={anim_frame * 5} y=100
        
        # 动画每一帧要执行的代码
        CODE name=frame_update
        [
        CLEAR color=black
        DRAW obj=MovingPoint color=yellow
        ]
        
        # 创建动画，运行代码并更新插槽
        CREATE ANIMATION name=my_anim code=frame_update slot=anim_frame interval=16 repeat=true
        ```

#### **数学表达式引擎**

任何数值参数都可以接受一个动态计算的复杂表达式。该引擎支持：

* **运算符**: `+` (加), `-` (减), `*` (乘), `/` (除), `%` (取模), `^` (幂)。
* **常量**: `PI`, `E`。
* **函数**:
    * 三角函数: `sin`, `cos`, `tan`, `cot`, `arcsin`, `arccos`, `arctan`, `arccot`。
    * 指数/对数: `exp` ($e^x$), `log` (自然对数)。
    * 其他: `abs` (绝对值), `sqrt` (平方根), `pow(base, exp)`, `floor` (向下取整), `ceil` (向上取整), `mod(a, b)`, `random()` (0到1的随机数), `max(a, b)`, `min(a, b)`。
* **使用示例**: `CREATE POINT name=P x={100 * cos(PI() / 4)} y={100 * sin(PI() / 4)}`
* **注意事项**: 这里的常量PI和E是采用无参函数的形式提供，所以使用方式为`PI()`和`E()`。