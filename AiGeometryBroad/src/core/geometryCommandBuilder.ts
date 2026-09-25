// 画布上「作图」动作到 DSL 代码的翻译。
//
// 抽成纯函数模块有三个原因：
// 1. 选择对话框要在用户还没点「确定」之前就实时预览将要插入的代码，
//    预览和最终插入必须来自同一次计算，不能各写一份；
// 2. 代码生成是这套交互里唯一能被离线断言的部分，独立出来才能脱离浏览器回归；
// 3. 对话框本身是通用的（复制画面 + 点选目标 + 填参数），
//    每个操作长什么样、需要点选什么、有哪些参数，全部由这里的描述符驱动。
//
// 这里不碰任何 DOM / React，只做「描述操作 + 拼指令」。

/**
 * 右键菜单里「在已选中的对象之间作图」的操作。
 *
 * 前五个只要两个对象；后五个分两组：
 * - `triangle` / `circumcircle` / `incircle` 要**三个点**；
 * - `angleBisector` / `parallelogram` 要**两条共端点的线**。
 */
export type SelectionOperation =
    | 'segment'
    | 'line'
    | 'perpBisector'
    | 'perpendicular'
    | 'intersect'
    | 'circleIntersect'
    | 'lineCircleIntersect'
    | 'pointCircleTangent'
    | 'triangle'
    | 'circumcircle'
    | 'incircle'
    | 'angleBisector'
    | 'parallelogram';

/** 需要三个点才能做的操作。菜单按这个集合决定要不要给「三点作图」那一组。 */
export const THREE_POINT_OPERATIONS: readonly SelectionOperation[] = ['triangle', 'circumcircle', 'incircle'];

/** 需要两条共端点直线的操作。 */
export const TWO_LINEAR_OPERATIONS: readonly SelectionOperation[] = ['angleBisector', 'parallelogram'];

/** 需要两个圆的操作。 */
export const TWO_CIRCLE_OPERATIONS: readonly SelectionOperation[] = ['circleIntersect'];

/** 需要一个点 + 一个圆的操作（过点作切线）。 */
export const POINT_CIRCLE_OPERATIONS: readonly SelectionOperation[] = ['pointCircleTangent'];

/** 需要一条线 + 一个圆的操作（求交点）。 */
export const LINE_CIRCLE_OPERATIONS: readonly SelectionOperation[] = ['lineCircleIntersect'];

/**
 * 选中一个圆时，右键菜单能做的操作。
 *
 * - `pointOnCircle`：在圆周上离鼠标最近处生成一点（角度 = 鼠标相对圆心的方向）；
 * - `circleCenter`：生成圆心点；
 * - `tangent`：过「圆周上离鼠标最近的点」作切线；
 * - `normal`：过该点作圆的法线（即过圆心与该点的直线）。
 *
 * 前三项都依赖右键那一刻的鼠标位置（画布坐标），所以走和 `PickOperation` 类似的
 * `anchorPoint` 通道；但它们是即时作图、不需要对话框。
 */
export type CircleOperation =
    | 'pointOnCircle'
    | 'circleCenter'
    | 'tangent'
    | 'normal';

/** 选中圆时菜单里出现的全部操作。 */
export const CIRCLE_OPERATIONS: readonly CircleOperation[] = ['pointOnCircle', 'circleCenter', 'tangent', 'normal'];

/**
 * 需要「先弹对话框，再点选目标 / 填参数」的操作。
 * 点操作（前四项）与线操作（后五项）共用同一套对话框。
 */
export type PickOperation =
    // —— 点：在对话框里再点一个点或一条直线或一个圆
    | 'connect'
    | 'parallel'
    | 'perpendicular'
    | 'reflectPoint'
    | 'tangentToCircle'
    // —— 线：多数只需要填参数，不需要再点选
    | 'pointOnLine'
    | 'divide'
    | 'extend'
    | 'intersect'
    | 'perpBisector'
    | 'cutSegment';

/** 对话框里允许用户点选的目标类型；null 表示这个操作不需要点选。 */
export type PickKind = 'point' | 'linear' | 'circle';

export interface Point2D {
    x: number;
    y: number;
}

/** 「连接另一个点」的产物类型。 */
export type ConnectType = 'segment' | 'line';

/** 「延长」的两种方式：延长一个长度，或直接延长成直线。 */
export type ExtendMode = 'length' | 'line';

/** 「延长」的方向。射线只有向前一个方向，所以它不会拿到 start/both。 */
export type ExtendSide = 'both' | 'start' | 'end';

/** 「截取线段」从哪一端开始量。 */
export type CutFrom = 'start' | 'end';

/** 解释器里对象的类型名（与几何类的 type 字段一致）。 */
export const POINT_TYPE = 'point';
export const LINEAR_TYPES = ['line', 'segment', 'ray'] as const;

export interface ObjectRef {
    name: string;
    type: string;
}

/** 参数值。对话框里的每个字段都读写这里的一个键。 */
export type OptionValues = Record<string, string | number | boolean>;

export type PickOptionField =
    | {
        kind: 'number';
        key: string;
        label: string;
        min: number;
        max: number;
        step: number;
        /** 只允许整数（等分份数这种）。 */
        integer?: boolean;
        visibleWhen?: (values: OptionValues) => boolean;
    }
    | {
        kind: 'select';
        key: string;
        label: string;
        options: ReadonlyArray<{ value: string; label: string }>;
        visibleWhen?: (values: OptionValues) => boolean;
    }
    | {
        kind: 'checkbox';
        key: string;
        label: string;
        visibleWhen?: (values: OptionValues) => boolean;
    };

export interface PickOperationDescriptor {
    title: string;
    hint: string;
    /** 需要在图形上点选的目标类型；null 表示只用参数，不用点选。 */
    pick: PickKind | null;
    fields: PickOptionField[];
    /** 所有字段的初始值。**即使字段被隐藏也要给出**，否则生成代码时会读到 undefined。 */
    defaults: OptionValues;
}

export interface CommandBuildContext {
    /** 当前脚本，用于避开脚本里已经出现过的名字。 */
    script: string;
    /**
     * 解释器里实际存在的对象名。
     * 只扫脚本文本是兜不住 `CREATE INTERSECT name=A,B obj1=.. obj2=..` 这种
     * 「一条指令建出多个对象」的写法的，所以把活动对象名也一起算进来。
     */
    objectNames?: Iterable<string>;
    /**
     * 取线性对象的两个定义点名字。等分点 / 延长 / 截取 / 中垂线都要用到：
     * 这些操作必须落在「对象自己的定义点」上才能随图形变化而动态更新，
     * 硬编码算出来的坐标一旦拖动就废了。
     */
    getLinearEndpoints?: (name: string) => { p1: string; p2: string } | null;
    /**
     * 取线性对象两个定义点的**逻辑坐标**。「在线上取点」要把鼠标位置投影到线上，
     * 光有名字算不了投影，得有真实坐标。等分 / 延长那些只引用名字的操作不需要它。
     */
    getLinearEndpointCoords?: (name: string) => { p1: Point2D; p2: Point2D } | null;
    /**
     * 取一个点对象的逻辑坐标。
     *
     * 只用来判断「三点是否共线」—— 共线时三角形 / 外接圆 / 内切圆都做不出来。
     * 判断要算叉积，光有名字算不了。**写进脚本的仍然是点名，不是坐标**：
     * 坐标写死之后一拖动就失效了。
     */
    getPointCoords?: (name: string) => { x: number; y: number } | null;
    /**
     * 取当前画布上**全部点对象**的名字与逻辑坐标。
     *
     * 两个圆求交点时要先查这两个交点里是不是已经有点存在了：已经有的那个不再重复建，
     * 只补建缺的那个。判断「点是否落在交点上」只能遍历所有点比坐标。
     * 写进脚本的仍然是点名，坐标只用于判断。
     */
    listPointCoords?: () => Array<{ name: string; x: number; y: number }>;
    /**
     * 取「落在某个线性对象上的全部点对象」（按参数 t 升序）。
     *
     * 「截取线段」用它把线上的点当成切割位置：删掉哪一段由这些点划出来，
     * 而不是拿鼠标位置临时投影一个切割点 —— 那样生成的对象会和原图形脱钩。
     */
    getPointsOnLinear?: (name: string) => Array<{ name: string; t: number }> | null;
    /**
     * 取一个圆对象的圆心点名、圆心逻辑坐标和半径。
     *
     * 「圆操作」要先知道圆心和半径：圆周上最近点的角度 = atan2(鼠标.y − 圆心.y, 鼠标.x − 圆心.x)，
     * 半径用来在命令生成阶段判断（实际写进脚本的仍是 `circle=圆名`，坐标不写死）。
     */
    getCircleInfo?: (name: string) => { centerName: string; center: Point2D; radius: number } | null;
    /**
     * 这个点名能不能直接写进 DSL 并被重新解析出来。
     *
     * 派生线（中垂线 / 平行线…）的两个定义点是内部合成点（`L_pb_<mid>` 这类），
     * 它们出现在画布上、但不在脚本里，写进 `cutPoints=` 就是一处悬空引用。
     * 裁剪时用这个判断把这类点从「可选的切割位置」里剔掉。
     */
    isReferenceablePoint?: (name: string) => boolean;
}

export interface PickOperationSpec {
    kind: PickOperation;
    /** 右键命中的那个对象，作图的主体。 */
    anchorName: string;
    /** 主体的类型（point / line / segment / ray），决定生成哪种指令。 */
    anchorType: string;
    /** 用户在对话框里点选的目标；不需要点选或还没点选时为 null。 */
    targetName: string | null;
    /**
     * 右键点击处（逻辑坐标）。「在线上取点」用它决定点落在线上哪里 ——
     * 位置来自右键那一刻的鼠标，不是对话框里的参数，所以单独放一个字段，
     * 不塞进 options（options 是用户可编辑的对话框字段）。
     */
    anchorPoint?: Point2D | null;
    /** 对话框里的参数值。 */
    options: OptionValues;
}

export interface PickValidation {
    ok: boolean;
    /** 不通过时给用户看的原因；通过时为空。 */
    message?: string;
}

export function isPointType(type: string | undefined): boolean {
    return type === POINT_TYPE;
}

export function isLinearType(type: string | undefined): boolean {
    return type != null && (LINEAR_TYPES as readonly string[]).includes(type);
}

/** 把对象名收拾成能安全放进 `{...}` 表达式里的标识符（槽位名要用）。 */
export function sanitizeIdentifier(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned;
}

// 判断脚本里是否已经用了某个对象名。
// 不能直接 `script.includes('name=' + candidate)`：`name=seg_A_B2` 会让候选 `seg_A_B`
// 被误判成「已占用」，于是名字一路带上无意义的后缀。这里要求候选名后面紧跟的
// 不是名字允许的字符，才算真正被占用。
function scriptHasObjectName(script: string, candidate: string): boolean {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`name\\s*=\\s*${escaped}(?![A-Za-z0-9_])`).test(script);
}

/**
 * 创建一个「取名字」分配器。
 *
 * 同一次作图可能一口气建好几个对象（例如等分点、两端延长），
 * 分配器内部会记住本次已经发出去的名字，避免自己跟自己撞名。
 *
 * **传进来的 prefix 必须短**（`perp` / `pt` / `seg` 这种），不要拼父对象名。
 * 早先的写法是 `${prefix}_${父1}_${父2}`，而父对象的名字自己又是拼出来的，
 * 于是名字随嵌套层数一路变长：`pt_perp_P1_L` -> `refl_pt_perp_P1_L_L` ->
 * `seg_P2_refl_pt_perp_P1_L_L`。既难读，又会被当成标签画到画布上糊成一片。
 * 现在统一「短前缀 + 序号」：`perp1` / `pt2` / `seg3`，重名由分配器补 `_2`。
 * 派生关系看指令自身的参数就够了（`point=P1 line=L`），不必编码进名字里。
 *
 * 顺带的好处：解释器内部的合成点（`<名字>_<mid>` / `<名字>_<pend>` 这类）
 * 是拿父对象名拼出来的，父名变短它们自然跟着变短。
 */
export function createNameAllocator(context: CommandBuildContext): (prefix: string) => string {
    const taken = new Set<string>(context.objectNames ?? []);
    return (prefix: string): string => {
        let candidate = prefix;
        let suffix = 2;
        while (taken.has(candidate) || scriptHasObjectName(context.script, candidate)) {
            candidate = `${prefix}_${suffix++}`;
        }
        taken.add(candidate);
        return candidate;
    };
}

/** 只需要一个名字时的便捷入口。 */
export function makeUniqueName(prefix: string, context: CommandBuildContext): string {
    return createNameAllocator(context)(prefix);
}

// 数值写进 DSL 时收一下精度，避免出现 0.30000000000000004 这种尾巴。
function formatNumber(value: number): string {
    return String(Number(value.toFixed(6)));
}

/**
 * 把用户输入的文字转义成能安全放进 `text="..."` 的形式。
 *
 * 换行必须是**字面量** `\n`（两个字符），不能真的把换行写进脚本 —— TEXT 是按行解析的，
 * 一个真实换行会把这条指令拦腰截断，后半截变成一条谁也看不懂的指令。
 * 反斜杠要先转义，否则内容里的 `\n` 会被二次解释；引号不转义的话也就没法表达。
 */
function escapeTextContent(content: string): string {
    return content
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r\n|\r|\n/g, '\\n');
}

function optionNumber(values: OptionValues, key: string, fallback: number): number {
    const raw = values[key];
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
    return Number.isFinite(num) ? num : fallback;
}

function optionString(values: OptionValues, key: string, fallback: string): string {
    const raw = values[key];
    return typeof raw === 'string' && raw.length > 0 ? raw : fallback;
}

function optionBoolean(values: OptionValues, key: string, fallback: boolean): boolean {
    const raw = values[key];
    return typeof raw === 'boolean' ? raw : fallback;
}

// ---------------------------------------------------------------- 操作清单

/** 右键菜单里各项的显示文案。结尾的 `…` 表示点下去会打开对话框。 */
export const PICK_OPERATION_LABELS: Record<PickOperation, string> = {
    connect: '连接另一个点…',
    parallel: '过该点作平行线…',
    perpendicular: '过该点作垂线…',
    reflectPoint: '关于直线作对称点…',
    tangentToCircle: '过该点作圆的切线…',
    pointOnLine: '在线上取点…',
    divide: '取 N 等分点…',
    extend: '延长…',
    cutSegment: '截取线段…',
    perpBisector: '作中垂线',
    intersect: '与另一条线求交点…',
};

// 不同主体类型能做什么。放在这里而不是散在菜单代码里，
// 以后加操作只要改这张表 + 描述符。
const PICK_OPERATIONS_BY_TYPE: Record<string, PickOperation[]> = {
    // 「过该点作圆的切线」放最前：右键一个点时它是最常见的诉求之一，
    // 也是唯一一个需要再点选「圆」这个第三类目标的操作。
    point: ['tangentToCircle', 'connect', 'parallel', 'perpendicular', 'reflectPoint'],
    // 等分 / 延长 / 截取都要求对象有确定的「两个定义点」，线段和射线都满足。
    // 「在线上取点」排在最前：它是线上最基础的操作，其余都是在它的基础上派生的。
    segment: ['pointOnLine', 'divide', 'extend', 'cutSegment', 'perpBisector', 'intersect'],
    ray: ['pointOnLine', 'divide', 'extend', 'cutSegment', 'perpBisector', 'intersect'],
    // 直线是无限长的，「等分」「延长」「截取」都没有意义，只留取点、中垂线与求交点。
    line: ['pointOnLine', 'perpBisector', 'intersect'],
    // 圆：过某点作圆的切线（切点 + 切线）。点和圆一起选中时也有同样的菜单。
    circle: ['tangentToCircle'],
};

/** 某个类型的主体支持哪些需要对话框的操作。 */
export function getPickOperationsForAnchor(anchorType: string): PickOperation[] {
    return PICK_OPERATIONS_BY_TYPE[anchorType] ?? [];
}

// ---------------------------------------------------------------- 描述符

const CONNECT_TYPE_FIELD: PickOptionField = {
    kind: 'select',
    key: 'connectType',
    label: '连接方式',
    options: [
        { value: 'segment', label: '线段' },
        { value: 'line', label: '直线' },
    ],
};

const EXTEND_MODE_FIELD: PickOptionField = {
    kind: 'select',
    key: 'mode',
    label: '延长方式',
    options: [
        { value: 'length', label: '延长指定长度' },
        { value: 'line', label: '延长成直线' },
    ],
};

const EXTEND_LENGTH_FIELD: PickOptionField = {
    kind: 'number',
    key: 'length',
    label: '延长长度',
    min: 0.1,
    max: 10000,
    step: 0.5,
    visibleWhen: values => optionString(values, 'mode', 'length') === 'length',
};

const EXTEND_SIDE_FIELD: PickOptionField = {
    kind: 'select',
    key: 'side',
    label: '延长方向',
    options: [
        { value: 'both', label: '两端' },
        { value: 'start', label: '起点端' },
        { value: 'end', label: '终点端' },
    ],
    visibleWhen: values => optionString(values, 'mode', 'length') === 'length',
};

/** 对话框标题 / 提示语 / 需要点选什么 / 有哪些参数。 */
export function describePickOperation(
    kind: PickOperation,
    anchorName: string,
    anchorType: string,
): PickOperationDescriptor {
    const isRay = anchorType === 'ray';

    switch (kind) {
        case 'connect':
            return {
                title: '连接另一个点',
                hint: `在下方图形中点击要与 ${anchorName} 连接的点`,
                pick: 'point',
                fields: [CONNECT_TYPE_FIELD],
                defaults: { connectType: 'segment' },
            };
        case 'parallel':
            return {
                title: '过点作平行线',
                hint: `点击一条直线或线段，过 ${anchorName} 作它的平行线`,
                pick: 'linear',
                fields: [],
                defaults: {},
            };
        case 'perpendicular':
            return {
                title: '过点作垂线',
                hint: `点击一条直线或线段，过 ${anchorName} 作它的垂线`,
                pick: 'linear',
                fields: [],
                defaults: {},
            };
        case 'reflectPoint':
            return {
                title: '作关于直线的对称点',
                hint: `点击一条直线或线段作为对称轴，作出 ${anchorName} 的对称点`,
                pick: 'linear',
                fields: [
                    {
                        kind: 'checkbox',
                        key: 'includeFoot',
                        label: '同时画出垂足和到对称点的连线',
                    },
                ],
                defaults: { includeFoot: true },
            };
        case 'tangentToCircle':
            return {
                title: '过该点作圆的切线',
                hint: `点击一个圆，过 ${anchorName} 作它的切线（圆外会作出两条并标出两个切点）`,
                pick: 'circle',
                fields: [
                    {
                        kind: 'checkbox',
                        key: 'showTangentPoints',
                        label: '画出切点',
                    },
                ],
                defaults: { showTangentPoints: true },
            };
        case 'pointOnLine':
            return {
                title: '在线上取点',
                hint: `在 ${anchorName} 上离刚才右键处最近的位置生成一个点`,
                pick: null,
                fields: [],
                defaults: {},
            };
        case 'divide':
            return {
                title: '取 N 等分点',
                hint: `把 ${anchorName} 按等分份数切开，在每个等分点处生成一个点`,
                pick: null,
                fields: [
                    {
                        kind: 'number',
                        key: 'count',
                        label: '等分份数 N',
                        min: 2,
                        max: 50,
                        step: 1,
                        integer: true,
                    },
                ],
                defaults: { count: 4 },
            };
        case 'extend':
            return {
                title: '延长',
                hint: isRay
                    ? `把 ${anchorName} 从方向点一侧继续延长`
                    : `把 ${anchorName} 往指定方向加长（原对象保留，新生成的是延长后的整条线段）`,
                pick: null,
                // 射线的 pointAtDistance 只会沿「顶点 -> 方向点」一个方向走，
                // 给它「起点端 / 两端」会得到方向错误的结果，所以干脆不给这两个选项。
                fields: isRay
                    ? [EXTEND_MODE_FIELD, EXTEND_LENGTH_FIELD]
                    : [EXTEND_MODE_FIELD, EXTEND_LENGTH_FIELD, EXTEND_SIDE_FIELD],
                defaults: { mode: 'length', length: 2, side: 'end' },
            };
        case 'cutSegment':
            return {
                title: '截取线段',
                hint: `从 ${anchorName} 的一端量出指定长度，生成一段新的线段`,
                pick: null,
                fields: [
                    {
                        kind: 'number',
                        key: 'length',
                        label: '截取长度',
                        min: 0.1,
                        max: 10000,
                        step: 0.5,
                    },
                    {
                        kind: 'select',
                        key: 'from',
                        label: '从哪一端',
                        options: [
                            { value: 'start', label: '起点端' },
                            { value: 'end', label: '终点端' },
                        ],
                    },
                ],
                defaults: { length: 2, from: 'start' },
            };
        case 'perpBisector':
            return {
                title: '作中垂线',
                hint: `过 ${anchorName} 两个定义点的中点作垂线`,
                pick: null,
                fields: [],
                defaults: {},
            };
        case 'intersect':
            return {
                title: '与另一条线求交点',
                hint: `点击另一条直线或线段，求它与 ${anchorName} 的交点`,
                pick: 'linear',
                fields: [],
                defaults: {},
            };
        default:
            return { title: '作图', hint: '', pick: null, fields: [], defaults: {} };
    }
}

// ---------------------------------------------------------------- 投影

/**
 * 把一个逻辑坐标投影到线性对象上，返回**归一化参数 t**：
 * 投影点 = p1 + t × (p2 − p1)，所以 t = 0 落在 p1、t = 1 落在 p2。
 *
 * 返回的是「该对象上离这个点最近的位置」对应的 t，按类型裁剪：
 * - `line`（直线）不裁剪，t 可以是负数或大于 1；
 * - `segment`（线段）裁到 [0, 1]；
 * - `ray`（射线）裁到 [0, +∞)。
 * 裁剪才是数学意义上的最近位置 —— 线段外面的点，最近位置就是端点本身。
 *
 * p1 与 p2 重合（长度为 0）时方向无法确定，返回 null 让调用方放弃作图。
 */
export function projectOntoLinear(
    target: Point2D,
    p1: Point2D,
    p2: Point2D,
    kind: string,
): number | null {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!(lengthSquared > 0)) return null;

    const t = ((target.x - p1.x) * dx + (target.y - p1.y) * dy) / lengthSquared;
    if (kind === 'segment') return Math.min(1, Math.max(0, t));
    if (kind === 'ray') return Math.max(0, t);
    return t;
}

// ---------------------------------------------------------------- 裁剪

/**
 * 「截取线段」里被切出来的一段：参数区间 `[startT, endT]` 加上两端的界点名。
 * `startT === null` 表示这一端在 −∞，`endT === null` 表示 +∞，此时对应的界点名也是 null。
 *
 * 端点全部来自**真实存在的点**，所以每一段都能直接拿点名字去生成 DSL ——
 * 这正是「依据线上的点」的落地方式：切割位置是点，不是鼠标位置。
 */
export interface LinearPiece {
    startT: number | null;
    endT: number | null;
    startName: string | null;
    endName: string | null;
    /** 界面上显示这一段用的文字，例如 `A → M`、`M → +∞`。 */
    label: string;
}

export interface LinearPieceSet {
    /** 沿线按参数升序排列的若干段，相邻两段首尾相接。 */
    pieces: LinearPiece[];
    /** 参与分段的全部界点（定义点 + 线上的点），按参数升序。 */
    cuts: Array<{ name: string; t: number }>;
    /** 算不出分段时的原因；能算出来时为空。 */
    blocked?: string;
}

/** 判断两个参数是不是同一个切割位置。只用来吸收浮点误差。 */
const PIECE_EPSILON = 1e-9;

/**
 * 把线性对象按「线上的点」切成若干段。
 *
 * 界点来自三处：对象自己的两个定义点，以及所有落在这个对象上的点对象。
 * 定义域按类型收口：线段 [0, 1]、射线 [0, +∞)、直线 (−∞, +∞)。
 * 直线和射线两端各多出一段无界的部分（`−∞ → A` / `Z → +∞`）。
 *
 * 定义点只在**能写回脚本**时才当界点用：派生线的定义点是 `L_pb_<mid>` 这类内部合成点，
 * 写进 `cutPoints=` 会变成悬空引用，所以把它们从切割位置里剔掉（定义域仍由它们界定）。
 *
 * 返回的段就是「鼠标点一下会删掉的那一段」，所以顺序必须是沿线的自然顺序。
 */
export function listLinearPieces(
    spec: { anchorName: string; anchorType: string },
    context: CommandBuildContext,
): LinearPieceSet {
    const { anchorName, anchorType } = spec;
    if (!anchorName) return { pieces: [], cuts: [], blocked: '没有可截取的对象' };
    if (!isLinearType(anchorType)) return { pieces: [], cuts: [], blocked: '只有直线、射线和线段可以截取' };

    const endpoints = context.getLinearEndpoints?.(anchorName);
    const coords = context.getLinearEndpointCoords?.(anchorName);
    if (!endpoints || !coords) return { pieces: [], cuts: [], blocked: `拿不到 ${anchorName} 的定义点，无法截取` };

    const { p1, p2 } = endpoints;
    const referenceable = context.isReferenceablePoint ?? (() => true);

    // 同一个位置上可能有不止一个点（交点又被取了一次之类），只留第一个，
    // 否则会切出一段长度为零的区间，用户点上去什么也删不掉。
    const collected: Array<{ name: string; t: number }> = [];
    if (referenceable(p1)) collected.push({ name: p1, t: 0 });
    if (referenceable(p2)) collected.push({ name: p2, t: 1 });
    for (const entry of context.getPointsOnLinear?.(anchorName) ?? []) {
        // 同理：落在线上的点里也混着内部合成点（`L_pb_<mid>` 自己就落在线上），
        // 它们同样写不进脚本，不能当切割位置。
        if (!referenceable(entry.name)) continue;
        collected.push({ name: entry.name, t: entry.t });
    }
    collected.sort((a, b) => a.t - b.t);

    const cuts: Array<{ name: string; t: number }> = [];
    for (const entry of collected) {
        if (cuts.some(existing => Math.abs(existing.t - entry.t) <= PIECE_EPSILON)) continue;
        cuts.push(entry);
    }

    // 按类型裁到定义域。直线两端都不裁，射线只裁掉 t < 0 的部分。
    const domainLo = anchorType === 'line' ? null : 0;
    const domainHi = anchorType === 'segment' ? 1 : null;
    const inDomain = cuts.filter(cut => (domainLo === null || cut.t >= domainLo - PIECE_EPSILON)
        && (domainHi === null || cut.t <= domainHi + PIECE_EPSILON));

    // 直线 / 射线只要有一个界点就能切出两段（`−∞ → A` 和 `A → +∞`），
    // 所以这里只要求「至少一个界点」。
    if (inDomain.length === 0) {
        return { pieces: [], cuts: inDomain, blocked: `${anchorName} 上没有可用的切割位置：先在线上取点再截取` };
    }

    // 线段的两端已经被定义点封住，没有中间的取点时整条线段就是一段，
    // 删掉它等于删对象本身，所以直接说清楚「要先取点」。
    if (anchorType === 'segment' && inDomain.length <= 2) {
        return { pieces: [], cuts: inDomain, blocked: '线段上还没有取点，先在线上取点才能截取' };
    }

    const pieces: LinearPiece[] = [];
    for (let i = 0; i < inDomain.length - 1; i++) {
        const start = inDomain[i];
        const end = inDomain[i + 1];
        pieces.push({
            startT: start.t,
            endT: end.t,
            startName: start.name,
            endName: end.name,
            label: `${start.name} → ${end.name}`,
        });
    }
    if (domainLo === null) {
        const first = inDomain[0];
        pieces.unshift({
            startT: null,
            endT: first.t,
            startName: null,
            endName: first.name,
            label: `−∞ → ${first.name}`,
        });
    }
    if (domainHi === null) {
        const last = inDomain[inDomain.length - 1];
        pieces.push({
            startT: last.t,
            endT: null,
            startName: last.name,
            endName: null,
            label: `${last.name} → +∞`,
        });
    }

    return { pieces, cuts: inDomain };
}

export interface LinearTrimResult {
    /** 结果对象名。新的截止点算法通常只有一个结果并沿用原对象名。 */
    name: string;
    /** 结果类型；LINE 保持为 line，RAY/SEGMENT 只在需要改变端点时使用。 */
    resultType: 'line' | 'segment' | 'ray';
    /** 线段是起点，射线是顶点。 */
    keepP1: string;
    /** 线段是终点，射线是方向点。 */
    keepP2: string;
}

export interface LinearPieceTrimPlan {
    /** 删掉一段之后的定义结果。新的 LINE/RAY 算法通常只有一个结果。 */
    results: LinearTrimResult[];
    /** 写入原定义行的截止点数组，带方向前缀：`+A` 砍正方向一侧，`-A` 砍负方向一侧。 */
    cutPointNames?: string[];
    /**
     * 需要在删除**之前**追加到脚本的指令。
     *
     * 鼠标停在无界尾部（`−∞ → A` / `A → +∞`）时，这一段的边界点根本不存在，
     * 只能按鼠标投影位置现场造一个点当边界 —— 这一条就是那条 `MEASURE` + `POINT_ON_LINE`。
     * 生成的点沿用「在线上取点」的槽位表达式写法，所以拖动原线端点后它依旧贴在线上同一相对位置。
     */
    preludeCommands?: string[];
}

export interface LinearPieceTrimOutcome {
    plan: LinearPieceTrimPlan | null;
    /** 不能截取的原因，直接给用户看。 */
    blocked?: string;
}


/**
 * 规划一次「删掉线上某一段」的截止点写回。
 *
 * 规划结果始终沿用原对象名和原定义点，只返回要追加到 cutPoints 的**带方向**点名：
 *   - `+A` 隐藏 A 的正方向一侧（保留参数 ≤ A 的部分）；
 *   - `-A` 隐藏 A 的负方向一侧（保留参数 ≥ A 的部分）。
 *
 * 于是「删掉 A→B 这一段」= `+A,-B`，`-∞ → A` = `-A`，`B → +∞` = `+B`，
 * 三段情形一套写法，不需要为射线头部 / 直线左尾各写一个特例，
 * 也不需要交换定义点（派生线的定义点本来就交换不了）。
 *
 * 脚本因此只需修改原定义行，不创建替代对象、遮罩对象或额外 DRAW。
 *
 * ---
 *
 * `pieceIndex` 是给「点菜单里第 n 段」这种确定位置用的。鼠标交互走的是
 * `tMouse`：只交出鼠标在线上投影的参数位置，由这里**按绝对值最近**找界的那个已知点，
 * 再删掉鼠标所在的相邻两点之间那一段。
 *
 * 为什么必须按鼠标重新算而不是用界面高亮的 index：
 * 界面上的分段按「定义点」划分，鼠标常离某个界点很近却落在相邻段里，
 * 直接按 index 删会多砍一截。按 `tMouse` 就近吸附才符合「删除不要过长」的直觉。
 *
 * 鼠标落在无界尾部时（`−∞ → A` 或 `A → +∞`），这一段的远端界点不存在，
 * 就在鼠标投影处现场造一个点当边界（`preludeCommands`），返回的名字由调用方一起写进 cutPoints。
 */
export function planLinearPieceRemoval(
    spec: { anchorName: string; anchorType: string; pieceIndex?: number; tMouse?: number; mousePoint?: Point2D },
    context: CommandBuildContext,
): LinearPieceTrimOutcome {
    const { anchorName, anchorType } = spec;
    const set = listLinearPieces({ anchorName, anchorType }, context);
    if (set.blocked) return { plan: null, blocked: set.blocked };

    const endpoints = context.getLinearEndpoints?.(anchorName);
    if (!endpoints) return { plan: null, blocked: `拿不到 ${anchorName} 的定义点，无法截取` };
    const { p1, p2 } = endpoints;

    const domainLo = anchorType === 'line' ? null : 0;
    const domainHi = anchorType === 'segment' ? 1 : null;

    let target: LinearPiece | undefined;

    if (typeof spec.tMouse === 'number' && Number.isFinite(spec.tMouse)) {
        target = resolvePieceByMouse(set, spec.tMouse, domainLo, domainHi);
    } else if (typeof spec.pieceIndex === 'number') {
        target = set.pieces[spec.pieceIndex];
    }

    if (!target) return { plan: null, blocked: '这一段不存在' };

    const resultType = anchorType === 'segment' ? 'segment' : anchorType === 'ray' ? 'ray' : 'line';
    const results: LinearTrimResult[] = [{ name: anchorName, resultType, keepP1: p1, keepP2: p2 }];

    let cutPointNames = [
        target.startName ? `+${target.startName}` : null,
        target.endName ? `-${target.endName}` : null,
    ].filter((name): name is string => name !== null);

    // 鼠标那一侧的界点不存在（无界尾部）：现场造一个点补上。
    const needsStartPoint = target.startName === null;
    const needsEndPoint = target.endName === null;

    if (needsStartPoint || needsEndPoint) {
        if (!spec.mousePoint) return { plan: null, blocked: '拿不到鼠标位置，无法在这一侧生成截点' };
        const coords = context.getLinearEndpointCoords?.(anchorName);
        if (!coords) return { plan: null, blocked: `拿不到 ${anchorName} 的坐标，无法生成截点` };

        const t = projectOntoLinear(spec.mousePoint, coords.p1, coords.p2, 'line');
        if (t === null) return { plan: null, blocked: '鼠标位置无法投影到线上' };

        const allocated = allocateBoundaryPoint(anchorName, t, p1, p2, context);
        if (!allocated) return { plan: null, blocked: '无法生成截取用的边界点' };

        if (needsStartPoint) cutPointNames = [`+${allocated.name}`, ...cutPointNames];
        if (needsEndPoint) cutPointNames = [...cutPointNames, `-${allocated.name}`];

        return {
            plan: {
                results,
                cutPointNames,
                preludeCommands: allocated.commands,
            },
        };
    }

    return { plan: { results, cutPointNames } };
}

/**
 * 按鼠标参数位置找出「鼠标所在的相邻两点之间」那一段。
 *
 * 先把鼠标的 `t` 夹进定义域（射线 t<0 吸到 0，线段 t 吸到 [0,1]），
 * 再取**区间包含 `t` 的那一段** —— 段的两端就是夹住鼠标的那两个已知点，
 * 无界尾部则用 `null` 表示（`−∞ → A`、`B → +∞`）。
 *
 * 这就是「删鼠标所在的相邻两点之间」的直译：鼠标落在哪两个界点中间，就删那两个界点之间。
 * 等价说法是「先找离鼠标最近的界点，再删它朝鼠标那一侧的一段」—— 不必分两步，
 * 直接查包含关系更快，也天然覆盖了鼠标超出最外侧界点的无界情形
 * （此时最近界点就是末界点，它朝鼠标那一侧正是 `末界点 → +∞`）。
 */
function resolvePieceByMouse(
    set: LinearPieceSet,
    tMouse: number,
    domainLo: number | null,
    domainHi: number | null,
): LinearPiece | undefined {
    let t = tMouse;
    if (domainLo !== null) t = Math.max(domainLo, t);
    if (domainHi !== null) t = Math.min(domainHi, t);

    return set.pieces.find(piece =>
        t >= (piece.startT ?? -Infinity) - PIECE_EPSILON
        && t <= (piece.endT ?? Infinity) + PIECE_EPSILON);
}

/**
 * 在鼠标投影位置生成一个可写回脚本的边界点。
 *
 * 用「在线上取点」那一套槽位表达式（`MEASURE type=distance` + `POINT_ON_LINE`），
 * 而不是写死坐标：这样拖动原线端点、重跑脚本后，截点会跟着回到线上同一个相对位置。
 * 距离一律从 `p1` 量出，`t < 0` 时改用 `p2` 作参考点（表达式里不出现负数字面量）。
 */
function allocateBoundaryPoint(
    anchorName: string,
    t: number,
    p1: string,
    p2: string,
    context: CommandBuildContext,
): { name: string; commands: string[] } | null {
    const allocate = createNameAllocator(context);
    const reference = t >= 0 ? p1 : p2;
    const ratio = t >= 0 ? t : 1 - t;
    const slot = `${sanitizeIdentifier(anchorName)}_len`;
    const name = allocate('cut');
    return {
        name,
        commands: [
            `MEASURE type=distance slot=${slot} p1=${p1} p2=${p2}`,
            `CREATE POINT_ON_LINE name=${name} line=${anchorName} point=${reference} distance={${slot} * ${formatNumber(ratio)}} draw=true`,
        ],
    };
}

// ---------------------------------------------------------------- 点选规则

/**
 * 判断用户在对话框里点中的对象能不能当作本次作图的目标。
 *
 * 单独抽出来是因为「点到了什么算数」是这套交互里最容易走偏的一条规则：
 * 连接操作要的是别的点（不能是作图主体自己），其余要点选的操作要的是线性对象。
 * 规则放在这里，对话框只负责显示 message。
 */
export function validatePick(
    pick: PickKind,
    hit: { name: string; type: string } | null,
    anchorName: string,
): PickValidation {
    if (!hit) {
        return {
            ok: false,
            message: pick === 'point'
                ? '这里没有点，请点击一个已画出的点'
                : pick === 'circle'
                    ? '这里没有圆，请点击一个已画出的圆'
                    : '这里没有直线，请点击一条已画出的直线或线段',
        };
    }
    if (hit.name === anchorName) {
        return { ok: false, message: `${anchorName} 是作图主体本身，请点击另一个对象` };
    }
    if (pick === 'point') {
        if (!isPointType(hit.type)) {
            return { ok: false, message: `${hit.name} 不是点，请点击一个点` };
        }
        return { ok: true };
    }
    if (pick === 'circle') {
        if (hit.type !== 'circle') {
            return { ok: false, message: `${hit.name} 不是圆，请点击一个圆` };
        }
        return { ok: true };
    }
    if (!isLinearType(hit.type)) {
        return { ok: false, message: `${hit.name} 不是直线，请点击一条直线或线段` };
    }
    return { ok: true };
}

// ---------------------------------------------------------------- 代码生成

/**
 * 「三点共线」判定的相对容差。
 *
 * 叉积的量纲是「长度²」，所以阈值要跟坐标跨度一起缩放，不能写死一个绝对值 ——
 * 否则坐标在 1e3 量级时浮点误差就会被判成不共线。
 */
const COLLINEAR_EPSILON = 1e-6;

/**
 * 三点是否共线。取不到坐标时返回 null（「不知道」），
 * 调用方据此放行业务逻辑 —— 宁可让人做了再看到退化图形，也别因为缺坐标就禁掉整个操作。
 */
function arePointsCollinear(names: string[], context: CommandBuildContext): boolean | null {
    if (names.length !== 3) return null;
    const coords = names.map(name => context.getPointCoords?.(name) ?? null);
    if (coords.some(item => item === null)) return null;
    const [a, b, c] = coords as Point2D[];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const scale = Math.max(
        Math.abs(b.x - a.x), Math.abs(b.y - a.y),
        Math.abs(c.x - a.x), Math.abs(c.y - a.y),
    );
    if (scale === 0) return true; // 三个点重合，退化
    return Math.abs(cross) <= scale * scale * COLLINEAR_EPSILON;
}

/**
 * 两条线性对象共用的端点，以及各自「另一端」的点名。
 *
 * 角平分线和平行四边形都要求两条线**恰好共一个端点**：
 * 没有公共端点就定不出角，两个端点都相同则是同一条线。
 */
type SharedVertexResult =
    | { vertex: string; farOfFirst: string; farOfSecond: string }
    | { blocked: string };

function resolveSharedVertex(
    first: ObjectRef,
    second: ObjectRef,
    context: CommandBuildContext,
): SharedVertexResult {
    const endsOfFirst = context.getLinearEndpoints?.(first.name);
    const endsOfSecond = context.getLinearEndpoints?.(second.name);
    if (!endsOfFirst || !endsOfSecond) {
        return { blocked: `取不到 ${first.name} / ${second.name} 的定义点` };
    }
    const firstEnds = [endsOfFirst.p1, endsOfFirst.p2];
    const secondEnds = [endsOfSecond.p1, endsOfSecond.p2];
    const shared = firstEnds.filter(name => secondEnds.includes(name));

    if (shared.length === 0) {
        return {
            blocked: `两条线没有公共端点（${first.name}: ${firstEnds.join('/')}，${second.name}: ${secondEnds.join('/')}）`,
        };
    }
    if (shared.length === 2) {
        return { blocked: '两条线的端点完全相同，定不出一个角' };
    }

    const vertex = shared[0];
    const farOfFirst = firstEnds[0] === vertex ? firstEnds[1] : firstEnds[0];
    const farOfSecond = secondEnds[0] === vertex ? secondEnds[1] : secondEnds[0];

    // 端点必须能在脚本里被引用。派生线（中垂线、平行线…）的定义点是内部合成点，
    // 写进 ANGLE / MIDPOINT 就是一处悬空引用 —— 重跑脚本时它根本不存在。
    const isReferenceable = context.isReferenceablePoint;
    if (isReferenceable) {
        const dangling = [vertex, farOfFirst, farOfSecond].filter(name => !isReferenceable(name));
        if (dangling.length > 0) {
            return { blocked: `端点 ${dangling.join('、')} 不在脚本里（派生线的合成点），无法引用` };
        }
    }
    return { vertex, farOfFirst, farOfSecond };
}

/** 圆-圆求交点用到的圆信息（与 CommandBuildContext.getCircleInfo 返回同构）。 */
interface CircleGeometry {
    centerName: string;
    center: Point2D;
    radius: number;
}

/**
 * 两个圆的交点（逻辑坐标）。0 / 1 / 2 个。
 *
 * 只用来在**生成命令之前**预判「有几个交点、哪些已经有点存在了」，
 * 好把菜单上要建几个点说清楚、没交点时置灰。真正建点由解释器按同样的几何算，
 * 这里不写死任何坐标进脚本。
 *
 * 判定与标准几何一致：
 * - 圆心距离 d，半径 r1 / r2；
 * - d > r1 + r2（外离）或 d < |r1 − r2|（内含）→ 无交点；
 * - d = 0 且 r1 = r2（同心同半径，两个圆重合）→ 不作无限多交点，视为无交点；
 * - d = r1 + r2 或 d = |r1 − r2|（相切）→ 1 个交点；
 * - 其余 → 2 个交点。
 */
function computeCircleIntersection(a: CircleGeometry, b: CircleGeometry): Point2D[] {
    const dx = b.center.x - a.center.x;
    const dy = b.center.y - a.center.y;
    const d = Math.hypot(dx, dy);
    const r1 = a.radius;
    const r2 = b.radius;
    const tolerance = 1e-9;

    // 同心：重合则有无穷多交点（这里视为不可用），否则无交点。
    if (d <= tolerance) {
        return [];
    }
    if (d > r1 + r2 + tolerance) return []; // 外离
    if (d < Math.abs(r1 - r2) - tolerance) return []; // 内含

    // 两交点连线（根轴）到 a 圆心的距离 aDist，以及半弦长 h。
    const aDist = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const hSquared = r1 * r1 - aDist * aDist;
    // 根轴与两圆心连线的交点（中间点）。
    const midX = a.center.x + (aDist * dx) / d;
    const midY = a.center.y + (aDist * dy) / d;

    if (hSquared <= tolerance) {
        // 相切：一个交点。
        return [{ x: midX, y: midY }];
    }

    const h = Math.sqrt(hSquared);
    // 垂直于两圆心连线方向的单位向量。
    const offX = (-dy * h) / d;
    const offY = (dx * h) / d;
    return [
        { x: midX + offX, y: midY + offY },
        { x: midX - offX, y: midY - offY },
    ];
}

/**
 * 直线 / 线段 / 射线与圆的交点（逻辑坐标）。0 / 1 / 2 个。
 *
 * 和解释器 `Circle.getIntersectionWithLine` 用同一套一元二次方程，区别是这里额外
 * 按对象类型裁剪参数 t 的取值区间：这样菜单里的预判结果和解释器实际算出来的
 * 完全一致 —— 比如一条线段落在圆外，解释器（当作无限直线解）会算出两个交点，
 * 而这里会正确地报「没有交点」。
 */
function computeLineCircleIntersection(
    p1: Point2D,
    p2: Point2D,
    circle: CircleGeometry,
    lineType: string,
): Point2D[] {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const A = dx * dx + dy * dy;
    if (A <= 1e-18) return []; // 两个定义点重合，方向无法确定

    const cx = p1.x - circle.center.x;
    const cy = p1.y - circle.center.y;
    const B = 2 * (dx * cx + dy * cy);
    const C = cx * cx + cy * cy - circle.radius * circle.radius;
    const delta = B * B - 4 * A * C;
    if (delta < -1e-9) return [];

    // t 是「从 p1 出发沿 p1->p2 方向的参数」，t=0 在 p1、t=1 在 p2。
    const roots: number[] = [];
    if (delta <= 1e-9) {
        roots.push(-B / (2 * A));
    } else {
        const sqrtDelta = Math.sqrt(delta);
        roots.push((-B - sqrtDelta) / (2 * A), (-B + sqrtDelta) / (2 * A));
    }

    const withinRange = (t: number): boolean => {
        if (lineType === 'segment') return t >= -1e-9 && t <= 1 + 1e-9;
        if (lineType === 'ray') return t >= -1e-9;
        return true; // 直线无限延伸
    };

    const points = roots.filter(withinRange).map(t => ({ x: p1.x + t * dx, y: p1.y + t * dy }));
    // 相切（重根）时按容差去重，避免返回两个几乎重合的点。
    if (points.length === 2 && Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) <= 1e-9) {
        return [points[0]];
    }
    return points;
}

/** 「在选中的对象之间作图」的结果：指令，外加做不了时的原因。 */
export interface SelectionOperationPlan {
    commands: string[];
    /**
     * 做不了的原因；有值时菜单项应当置灰，并把这句话放进悬停提示。
     * 置灰比「点了没反应」好，但**只置灰不给原因**又等于让人猜，所以两者是一对。
     */
    blocked?: string;
    /**
     * 这次作图**实际会新建几个点**（目前只有两圆求交点用到）。
     * 两个交点里可能已经有一个点存在了，这时只会补建一个 —— 菜单据此把数量写在项上，
     * 让用户点之前就知道会多出几个点。其余操作不填。
     */
    newPointCount?: number;
}

/**
 * 把「在选中的对象之间作图」翻译成 DSL 指令。
 *
 * 单个对象、或对象类型不符合操作要求时返回空指令数组 —— 菜单据此不放这一项。
 */
export function planSelectionOperation(
    operation: SelectionOperation,
    objects: ObjectRef[],
    context: CommandBuildContext,
): SelectionOperationPlan {
    const allocate = createNameAllocator(context);

    // ---- 三个点：三角形 / 外接圆 / 内切圆
    if (THREE_POINT_OPERATIONS.includes(operation)) {
        if (objects.length !== 3) return { commands: [], blocked: '需要选中三个点' };
        if (!objects.every(item => isPointType(item.type))) {
            return { commands: [], blocked: '这个操作需要三个点' };
        }
        const names = objects.map(item => item.name);
        if (new Set(names).size !== 3) {
            return { commands: [], blocked: '三个点里有重复的' };
        }
        if (arePointsCollinear(names, context)) {
            return { commands: [], blocked: '三点共线，做不出三角形 / 外接圆 / 内切圆' };
        }
        const prefix = operation === 'triangle' ? 'tri' : operation === 'circumcircle' ? 'cc' : 'ic';
        const commandType = operation === 'triangle' ? 'TRIANGLE' : operation === 'circumcircle' ? 'CIRCUMCIRCLE' : 'INCIRCLE';
        const name = allocate(prefix);
        return {
            commands: [`CREATE ${commandType} name=${name} p1=${names[0]} p2=${names[1]} p3=${names[2]} draw=true`],
        };
    }

    // ---- 两条线：角平分线 / 平行四边形
    if (TWO_LINEAR_OPERATIONS.includes(operation)) {
        if (objects.length !== 2) return { commands: [], blocked: '需要选中两条线' };
        const [first, second] = objects;
        if (!isLinearType(first.type) || !isLinearType(second.type)) {
            return { commands: [], blocked: '这个操作需要两条直线或线段' };
        }
        const resolved = resolveSharedVertex(first, second, context);
        if ('blocked' in resolved) return { commands: [], blocked: resolved.blocked };
        const { vertex, farOfFirst, farOfSecond } = resolved;

        if (operation === 'angleBisector') {
            // ANGLE 的角度是**有符号**的（从 p1 转到 p2），所以 p1 必须放第一条线的另一端、
            // p2 放第二条的 —— 这才对得上「从第一条到第二条的方向」。
            // showArc=false：角本身不画，只画角平分线；否则图上会多一条弧。
            const angleName = allocate('ang');
            const bisectorName = allocate('ab');
            return {
                commands: [
                    `CREATE ANGLE name=${angleName} vertex=${vertex} p1=${farOfFirst} p2=${farOfSecond} showArc=false`,
                    `CREATE ANGLE_BISECTOR name=${bisectorName} angle=${angleName} draw=true`,
                ],
            };
        }

        // 平行四边形：缺的第四个顶点 = B + C − A。
        // DSL 里没有 PARALLELOGRAM，也不该为此硬编码坐标（一拖动就失效），
        // 所以走「BC 的中点 M，再把 A 关于 M 作中心对称」—— 2M − A 正好就是 B + C − A。
        // 两条辅助线都不画：中点 M 只是推导用的，第四个点画出来（它也是可拖的顶点）。
        const midName = allocate('mid');
        const fourthName = allocate('pt');
        const shapeName = allocate('pg');
        return {
            commands: [
                `CREATE MIDPOINT name=${midName} p1=${farOfFirst} p2=${farOfSecond} draw=false`,
                `CREATE REFLECTED_POINT name=${fourthName} obj=${vertex} center=${midName} draw=true`,
                `CREATE POLYGON name=${shapeName} points=${vertex},${farOfFirst},${fourthName},${farOfSecond} draw=true`,
            ],
        };
    }

    if (operation === 'segment' || operation === 'line' || operation === 'perpBisector') {
        if (objects.length !== 2) return { commands: [] };
        const [p1, p2] = objects;
        const prefix = operation === 'segment' ? 'seg' : operation === 'line' ? 'line' : 'pb';
        const commandType = operation === 'segment' ? 'SEGMENT' : operation === 'line' ? 'LINE' : 'PERP_BISECTOR';
        const name = allocate(prefix);
        return { commands: [`CREATE ${commandType} name=${name} p1=${p1.name} p2=${p2.name} draw=true`] };
    }

    // 两条线性对象求交点：选中两条线时最直接的诉求。
    if (operation === 'intersect') {
        if (objects.length !== 2) return { commands: [] };
        const [first, second] = objects;
        if (!isLinearType(first.type) || !isLinearType(second.type)) return { commands: [] };
        const name = allocate('P');
        return { commands: [`CREATE INTERSECT name=${name} obj1=${first.name} obj2=${second.name} draw=true`] };
    }

    // 两个圆求交点：和两线求交点的诉求一样，但交点最多两个，而且可能已经有点落在上面了。
    if (operation === 'circleIntersect') {
        if (objects.length !== 2) return { commands: [], blocked: '需要选中两个圆' };
        const [first, second] = objects;
        if (first.type !== 'circle' || second.type !== 'circle') {
            return { commands: [], blocked: '这个操作需要两个圆' };
        }
        const info1 = context.getCircleInfo?.(first.name);
        const info2 = context.getCircleInfo?.(second.name);
        if (!info1 || !info2) {
            return { commands: [], blocked: '取不到圆的圆心和半径' };
        }

        const intersection = computeCircleIntersection(info1, info2);
        if (intersection.length === 0) {
            return { commands: [], blocked: '这两个圆没有交点' };
        }

        // 先看这两个交点里是不是已经有点存在了：已经有的不再重复建，只补缺的那个。
        // 判断口径必须和解释器 TwoCirclesIntersection 的 findPoint 一致（同样容差）。
        const existingPoints = context.listPointCoords?.() ?? [];
        const tolerance = 1e-6;

        // 已经有点落在某个交点上 → 那个交点无需再建。
        const alreadyExists = (p: Point2D) =>
            existingPoints.some(item => Math.hypot(item.x - p.x, item.y - p.y) <= tolerance);

        const missing = intersection.filter(p => !alreadyExists(p));

        if (missing.length === 0) {
            // 两个交点都已存在，没有可建的点了。
            return { commands: [], blocked: '这两个交点都已经存在了' };
        }

        // 仍然给出两个候选名：解释器会自己跳过已存在的那个（它按坐标 findPoint）。
        // 这样即便我们这里的预判和解释器的浮点判断有一丁点出入，也不会建重复点。
        const nameA = allocate('P');
        const nameB = allocate('P');
        return {
            commands: [
                `CREATE INTERSECT name=${nameA},${nameB} obj1=${first.name} obj2=${second.name} draw=true`,
            ],
            newPointCount: missing.length,
        };
    }

    // 直线（线段 / 射线）与圆求交点：最多两个交点，可能已经有点落在上面了。
    // 和两圆求交点用同一套「先查已有点、只补缺的那些」逻辑，只是交点由直线与圆算出。
    if (operation === 'lineCircleIntersect') {
        if (objects.length !== 2) return { commands: [], blocked: '需要选中一个圆和一条线' };
        const line = objects.find(item => isLinearType(item.type));
        const circleRef = objects.find(item => item.type === 'circle');
        if (!line || !circleRef) return { commands: [], blocked: '这个操作需要一条线和一圆' };

        const info = context.getCircleInfo?.(circleRef.name);
        if (!info) return { commands: [], blocked: '取不到圆的圆心和半径' };
        const lineCoords = context.getLinearEndpointCoords?.(line.name);
        if (!lineCoords) return { commands: [], blocked: '取不到直线的两个端点坐标' };

        const intersection = computeLineCircleIntersection(
            lineCoords.p1, lineCoords.p2, info, line.type,
        );
        if (intersection.length === 0) {
            return { commands: [], blocked: '这条线与圆没有交点' };
        }

        const existingPoints = context.listPointCoords?.() ?? [];
        const tolerance = 1e-6;
        const alreadyExists = (p: Point2D) =>
            existingPoints.some(item => Math.hypot(item.x - p.x, item.y - p.y) <= tolerance);
        const missing = intersection.filter(p => !alreadyExists(p));

        if (missing.length === 0) {
            return { commands: [], blocked: '这些交点都已经存在了' };
        }

        const nameA = allocate('P');
        const nameB = allocate('P');
        return {
            commands: [
                `CREATE INTERSECT name=${nameA},${nameB} obj1=${line.name} obj2=${circleRef.name} draw=true`,
            ],
            newPointCount: missing.length,
        };
    }

    // 过一圆外（或圆上）的点作圆的切线，并标出切点。
    if (operation === 'pointCircleTangent') {
        if (objects.length !== 2) return { commands: [], blocked: '需要选中一个点和一个圆' };
        const point = objects.find(item => isPointType(item.type));
        const circleRef = objects.find(item => item.type === 'circle');
        if (!point || !circleRef) return { commands: [], blocked: '这个操作需要一个点和一个圆' };

        const info = context.getCircleInfo?.(circleRef.name);
        const coords = context.getPointCoords?.(point.name);
        if (!info || !coords) return { commands: [], blocked: '取不到点或圆的坐标' };

        const distance = Math.hypot(coords.x - info.center.x, coords.y - info.center.y);
        if (distance < info.radius - 1e-6) {
            return { commands: [], blocked: '这个点在圆内，过它作不出圆的切线' };
        }
        // 圆上一点 → 一条切线一个切点；圆外 → 两条切线两个切点。
        const onCircle = Math.abs(distance - info.radius) <= 1e-6;

        const t1 = allocate('T');
        const t2 = allocate('T');
        const nameParam = onCircle ? t1 : `${t1},${t2}`;
        return {
            commands: [`CREATE TANGENT name=${nameParam} circle=${circleRef.name} point=${point.name} draw=true`],
            newPointCount: onCircle ? 1 : 2,
        };
    }

    // 过点作垂线：需要一个点和一条直线（线段、射线同样可以）。
    if (objects.length !== 2) return { commands: [] };
    const point = objects.find(item => isPointType(item.type));
    const line = objects.find(item => isLinearType(item.type));
    if (!point || !line) return { commands: [] };
    const name = allocate('perp');
    return { commands: [`CREATE PERPENDICULAR name=${name} point=${point.name} line=${line.name} draw=true`] };
}

/** 「选中一个圆时作图」的结果：指令，外加做不了时的原因。 */
export interface CircleOperationPlan {
    commands: string[];
    blocked?: string;
}

/**
 * 把「针对单个圆的作图」翻译成 DSL 指令。
 *
 * `circleCenter` 只依赖圆本身；`pointOnCircle` / `tangent` / `normal` 还要右键那一刻的
 * 鼠标位置（用来决定圆周上那个点落在哪个角度）。这些操作生成的都是「引用圆对象」的指令，
 * 不是写死坐标 —— 圆被拖动时，圆周上的点、切线、法线都会跟着圆走。
 */
export function planCircleOperation(
    operation: CircleOperation,
    anchor: ObjectRef,
    anchorPoint: Point2D | null,
    context: CommandBuildContext,
): CircleOperationPlan {
    const allocate = createNameAllocator(context);
    if (anchor.type !== 'circle') {
        return { commands: [], blocked: '这个操作需要一个圆' };
    }
    const info = context.getCircleInfo?.(anchor.name);
    if (!info) return { commands: [], blocked: `取不到 ${anchor.name} 的圆心和半径` };

    // 圆心点：只依赖圆本身，每次重跑都从 circle.center 重新取值，跟着圆走。
    if (operation === 'circleCenter') {
        const name = allocate('O');
        return { commands: [`CREATE CIRCLE_CENTER name=${name} circle=${anchor.name} draw=true`] };
    }

    // 以下三项都要「圆周上离鼠标最近的点」—— 角度来自鼠标相对圆心的方向。
    if (!anchorPoint) {
        return { commands: [], blocked: '请在圆上点一下再选择这个操作' };
    }
    const angle = Math.atan2(anchorPoint.y - info.center.y, anchorPoint.x - info.center.x) * 180 / Math.PI;

    if (operation === 'pointOnCircle') {
        const name = allocate('P');
        return {
            commands: [`CREATE POINT_ON_CIRCLE name=${name} circle=${anchor.name} angle=${formatNumber(angle)} draw=true`],
        };
    }

    if (operation === 'tangent') {
        // 先取圆周上的切点（不画），再对它作切线（切线画出来）。
        const contactName = allocate('pt');
        const tangentName = allocate('tan');
        return {
            commands: [
                `CREATE POINT_ON_CIRCLE name=${contactName} circle=${anchor.name} angle=${formatNumber(angle)} draw=false`,
                `CREATE TANGENT name=${tangentName} circle=${anchor.name} point=${contactName} draw=true`,
            ],
        };
    }

    // 法线：过该点作圆的法线 = 过圆心与该点的直线。圆心点（不画）和切点（不画）都从圆对象推出来。
    const contactName = allocate('pt');
    const centerName = allocate('O');
    const lineName = allocate('normal');
    return {
        commands: [
            `CREATE POINT_ON_CIRCLE name=${contactName} circle=${anchor.name} angle=${formatNumber(angle)} draw=false`,
            `CREATE CIRCLE_CENTER name=${centerName} circle=${anchor.name} draw=false`,
            `CREATE LINE name=${lineName} p1=${centerName} p2=${contactName} draw=true`,
        ],
    };
}

/** 把「选中的两个对象之间作图」翻译成 DSL 指令（只要指令、不要原因时用这个）。 */
export function buildSelectionOperationCommands(
    operation: SelectionOperation,
    objects: ObjectRef[],
    context: CommandBuildContext,
): string[] {
    return planSelectionOperation(operation, objects, context).commands;
}

/**
 * 把「针对单个对象的作图」翻译成 DSL 指令。
 *
 * 需要点选却还没点选、或者拿不到定义点时返回空数组（对话框据此禁用「确定」）。
 */
export function buildPickOperationCommands(
    spec: PickOperationSpec,
    context: CommandBuildContext,
): string[] {
    const { kind, anchorName, anchorType, targetName, anchorPoint, options } = spec;
    if (!anchorName) return [];
    const allocate = createNameAllocator(context);

    // ---- 需要点选目标的点操作
    if (
        kind === 'connect' || kind === 'parallel' || kind === 'perpendicular'
        || kind === 'reflectPoint' || kind === 'tangentToCircle'
    ) {
        if (!targetName) return [];

        if (kind === 'connect') {
            const connectType = optionString(options, 'connectType', 'segment') === 'line' ? 'line' : 'segment';
            // 名字前缀与指令名要分开：指令是 SEGMENT / LINE，但名字用 seg / line，
            // 跟「选中两个点」那条路径取的名字共用同一套前缀。
            const prefix = connectType === 'line' ? 'line' : 'seg';
            const name = allocate(prefix);
            const commandType = connectType === 'line' ? 'LINE' : 'SEGMENT';
            return [`CREATE ${commandType} name=${name} p1=${anchorName} p2=${targetName} draw=true`];
        }
        if (kind === 'parallel') {
            const name = allocate('para');
            return [`CREATE PARALLEL name=${name} line=${targetName} point=${anchorName} draw=true`];
        }
        if (kind === 'perpendicular') {
            const name = allocate('perp');
            return [`CREATE PERPENDICULAR name=${name} line=${targetName} point=${anchorName} draw=true`];
        }
        if (kind === 'tangentToCircle') {
            // 这两个入口都能发起「过点作切线」：
            //   - 右键一个点 → 主体是点，点选的目标是圆；
            //   - 右键一个圆 → 主体是圆，点选的目标是点。
            // 所以先按类型认角色，而不是假定「主体一定是点」。
            const circleName = anchorType === 'circle' ? anchorName : targetName;
            const pointName = anchorType === 'circle' ? targetName : anchorName;
            if (!circleName || !pointName) return [];
            // 切点名字给两个（圆外时正好用完；圆上时解释器只用第一个）。
            // 切点是否画出来由 `showPoints` 控制（默认画），切线始终画（它就是本操作的产物）。
            const t1 = allocate('T');
            const t2 = allocate('T');
            const showPoints = optionBoolean(options, 'showTangentPoints', true);
            const showPointsParam = showPoints ? '' : ' showPoints=false';
            return [`CREATE TANGENT name=${t1},${t2} circle=${circleName} point=${pointName} draw=true${showPointsParam}`];
        }
        // 轴对称点。可选地把垂足和「点 — 对称点」的虚线也画出来，
        // 否则图上只有一个孤零零的对称点，看不出对称关系。
        const name = allocate('refl');
        const commands = [`CREATE REFLECTED_POINT name=${name} obj=${anchorName} axis=${targetName} draw=true`];
        if (optionBoolean(options, 'includeFoot', false)) {
            const footName = allocate('foot');
            const linkName = allocate('link');
            commands.push(`CREATE PERPENDICULAR_FOOT name=${footName} point=${anchorName} obj=${targetName} draw=true`);
            commands.push(`CREATE SEGMENT name=${linkName} p1=${anchorName} p2=${name} draw=true style=dashed`);
        }
        return commands;
    }

    // ---- 其余操作都作用在主体自己的两个定义点上
    const endpoints = context.getLinearEndpoints?.(anchorName);
    if (!endpoints) return [];
    const { p1, p2 } = endpoints;

    if (kind === 'intersect') {
        if (!targetName) return [];
        const name = allocate('P');
        return [`CREATE INTERSECT name=${name} obj1=${anchorName} obj2=${targetName} draw=true`];
    }

    if (kind === 'perpBisector') {
        const name = allocate('pb');
        return [`CREATE PERP_BISECTOR name=${name} p1=${p1} p2=${p2} draw=true`];
    }

    if (kind === 'pointOnLine') {
        // 位置来自右键点击处，拿不到就没法作图（对话框里的「确定」会保持禁用）。
        const coords = context.getLinearEndpointCoords?.(anchorName);
        if (!coords || !anchorPoint) return [];
        const t = projectOntoLinear(anchorPoint, coords.p1, coords.p2, anchorType);
        if (t === null) return [];

        // 距离用槽位表达式而不是算好的数字，跟等分点同一个道理：
        // 拖动端点后脚本重跑，MEASURE 重新量长度，点会回到线上「同一个相对位置」。
        //
        // t < 0 说明最近位置在 p1 外侧，改用 p2 当参考点（pointAtDistance 会沿 p2 -> p1 走），
        // 于是表达式里永远不出现负数字面量 —— `{len * -0.3}` 这种写法在表达式求值里不可靠。
        const reference = t >= 0 ? p1 : p2;
        const ratio = t >= 0 ? t : 1 - t;
        const slot = `${sanitizeIdentifier(anchorName)}_len`;
        const name = allocate('pt');
        return [
            `MEASURE type=distance slot=${slot} p1=${p1} p2=${p2}`,
            `CREATE POINT_ON_LINE name=${name} line=${anchorName} point=${reference} distance={${slot} * ${formatNumber(ratio)}} draw=true`,
        ];
    }

    if (kind === 'divide') {
        const count = Math.max(2, Math.min(50, Math.round(optionNumber(options, 'count', 4))));
        const slot = `${sanitizeIdentifier(anchorName)}_len`;
        const commands = [`MEASURE type=distance slot=${slot} p1=${p1} p2=${p2}`];
        // 内部等分点：i = 1 .. N-1。距离用槽位表达式而不是算好的数字，
        // 这样拖动端点之后等分点会跟着走。
        for (let i = 1; i < count; i++) {
            const name = allocate(`D${i}`);
            commands.push(
                `CREATE POINT_ON_LINE name=${name} line=${anchorName} point=${p1} distance={${slot} * ${i} / ${count}} draw=true`,
            );
        }
        return commands;
    }

    if (kind === 'cutSegment') {
        const length = Math.max(0.1, optionNumber(options, 'length', 2));
        const fromStart = optionString(options, 'from', 'start') !== 'end';
        const origin = fromStart ? p1 : p2;
        const name = allocate('C1');
        const segmentName = allocate('cut');
        return [
            `CREATE POINT_ON_LINE name=${name} line=${anchorName} point=${origin} distance=${formatNumber(length)} draw=true`,
            `CREATE SEGMENT name=${segmentName} p1=${origin} p2=${name} draw=true`,
        ];
    }

    // kind === 'extend'
    if (optionString(options, 'mode', 'length') === 'line') {
        // 延长成直线：直接以原对象的两个定义点作一条直线。
        const name = allocate('extLine');
        return [`CREATE LINE name=${name} p1=${p1} p2=${p2} draw=true`];
    }

    const length = Math.max(0.1, optionNumber(options, 'length', 2));
    const side = optionString(options, 'side', 'end');
    const slot = `${sanitizeIdentifier(anchorName)}_len`;
    const commands = [`MEASURE type=distance slot=${slot} p1=${p1} p2=${p2}`];

    // pointAtDistance 的方向规则：以 p1 为参考点就往 p2 方向走，以 p2 为参考点就往 p1 方向走。
    // 所以「往 p2 外侧延长」= 从 p1 量出「原长 + 延长量」。
    let startName = p1;
    let endName = p2;
    if (side === 'end' || side === 'both') {
        const name = allocate('E2');
        commands.push(
            `CREATE POINT_ON_LINE name=${name} line=${anchorName} point=${p1} distance={${slot} + ${formatNumber(length)}} draw=true`,
        );
        endName = name;
    }
    if (side === 'start' || side === 'both') {
        const name = allocate('E1');
        commands.push(
            `CREATE POINT_ON_LINE name=${name} line=${anchorName} point=${p2} distance={${slot} + ${formatNumber(length)}} draw=true`,
        );
        startName = name;
    }
    const segmentName = allocate('ext');
    commands.push(`CREATE SEGMENT name=${segmentName} p1=${startName} p2=${endName} draw=true`);
    return commands;
}

// ---------------------------------------------------------------- 空选右键：创建基本图形

/** 「空选右键」菜单里能创建的基本图形。 */
export type CreateShapeKind =
    | 'point' | 'segment' | 'line' | 'ray'
    | 'circle' | 'triangle' | 'rectangle' | 'square'
    | 'text' | 'axis' | 'grid';

/** 菜单目录节点：带 `children` 的是分类（渲染成二级菜单），带 `kind` 的是叶子。 */
export interface CreateShapeCatalogEntry {
    id: string;
    label: string;
    /** 叶子节点要创建的图形；分类节点没有它。 */
    kind?: CreateShapeKind;
    /** 分类节点的子项。 */
    children?: CreateShapeCatalogEntry[];
    /** 悬停提示。 */
    title?: string;
}

/**
 * 空选右键菜单的目录。
 *
 * 分类不是凑数：十来个图形平铺在一个菜单里要来回找，分组之后每级最多 3 项。
 * 「点」和「圆」各自只有一个成员，就不单设分类，直接当叶子。
 */
export const CREATE_SHAPE_CATALOG: CreateShapeCatalogEntry[] = [
    { id: 'point', label: '点', kind: 'point', title: '在右键处放一个点' },
    {
        id: 'linear',
        label: '线',
        children: [
            { id: 'segment', label: '线段', kind: 'segment' },
            { id: 'line', label: '直线', kind: 'line' },
            { id: 'ray', label: '射线', kind: 'ray' },
        ],
    },
    { id: 'circle', label: '圆', kind: 'circle', title: '在右键处画一个圆' },
    // 文字和「点」「圆」一样是单成员，不单独分类。它点下去会先弹一个输入与渲染对话框
    // （内容 / 字号 / 颜色 / 字体 / 背景），确定后才生成 TEXT 指令。
    { id: 'text', label: '文字', kind: 'text', title: '在右键处插入一段文字（支持 $LaTeX$）' },
    {
        id: 'polygon',
        label: '多边形',
        children: [
            { id: 'triangle', label: '三角形', kind: 'triangle' },
            { id: 'rectangle', label: '长方形', kind: 'rectangle' },
            { id: 'square', label: '正方形', kind: 'square' },
        ],
    },
    {
        id: 'coordinate',
        label: '坐标系',
        children: [
            { id: 'axis', label: '坐标轴', kind: 'axis', title: '范围和步长自动贴合当前可见区域' },
            { id: 'grid', label: '网格', kind: 'grid', title: '范围和步长自动贴合当前可见区域' },
        ],
    },
];

/**
 * 空选右键新建「文字」时用户填的内容与样式。
 *
 * 单独放一个字段而不是塞进 `CreateShapeSpec` 顶层，是因为只有 `kind === 'text'` 才用得上；
 * 顶层塞一堆 `textFontSize` 之类的可选字段会让其它图形的调用点也得写一堆 `undefined`。
 */
export interface CreateTextSpec {
    /** 文字内容。支持 `$LaTeX$` 片段；空串视为无效（不生成指令）。 */
    content: string;
    /** 字号，单位像素。 */
    fontSize: number;
    /** 文字颜色，CSS 颜色字符串（`#rrggbb` 或颜色名）。 */
    color: string;
    /** 字体族。 */
    fontFamily: string;
    /** 是否斜体。 */
    italic: boolean;
    /** 是否粗体。 */
    bold: boolean;
    /** 背景色；空串表示无背景。 */
    backgroundColor: string;
    /** 背景内边距（像素），仅在有背景色时有效。 */
    padding: number;
}

export interface CreateShapeSpec {
    kind: CreateShapeKind;
    /** 右键处的逻辑坐标，新图形以此为落脚点。 */
    anchor: Point2D;
    /**
     * 默认尺寸（逻辑长度）。画布按右键那一刻的缩放折算成约 80 屏幕像素，
     * 这样不同缩放下新建的图形看起来一样大。
     */
    size: number;
    /** 只有 `kind === 'text'` 用得到：文字内容与样式。 */
    text?: CreateTextSpec;
}

/**
 * 把「在右键处创建基本图形」翻译成 DSL 指令。
 *
 * 除 POINT 之外，DSL 里没有哪个图形能直接吃坐标（`LINE`/`CIRCLE`/`TRIANGLE`… 的参数
 * 一律是点名），所以先建出落脚点，再让图形引用它们。这些点一律 `draw=true`：
 * 在这个应用里「拖动点改变图形」是主要编辑手势，不把落脚点画出来用户就无从下手；
 * 而且点一拖，引用它的图形跟着变 —— 这正是脚本化几何该有的样子。
 */
export function buildCreateShapeCommands(spec: CreateShapeSpec, context: CommandBuildContext): string[] {
    const allocate = createNameAllocator(context);
    const unit = Number.isFinite(spec.size) && spec.size > 0 ? spec.size : 1;
    const ax = spec.anchor.x;
    const ay = spec.anchor.y;

    // 建一个落脚点，并把名字还回来给图形引用。
    const makePoint = (x: number, y: number): { name: string; command: string } => {
        const name = allocate('P');
        return { name, command: `CREATE POINT name=${name} x=${formatNumber(x)} y=${formatNumber(y)} draw=true` };
    };

    // 逻辑坐标的 y 轴朝上（screenToLogicalPoint 把屏幕 y 翻转过），
    // 所以正偏移 = 屏幕上往右、往上。图形一律铺在右键处的右上方，不出现负数字面量。
    const right = ax + unit;

    switch (spec.kind) {
        case 'point': {
            return [makePoint(ax, ay).command];
        }
        case 'segment':
        case 'line': {
            const a = makePoint(ax, ay);
            const b = makePoint(right, ay + unit * 0.5);
            const isSegment = spec.kind === 'segment';
            const name = allocate(isSegment ? 'seg' : 'line');
            return [
                a.command,
                b.command,
                `CREATE ${isSegment ? 'SEGMENT' : 'LINE'} name=${name} p1=${a.name} p2=${b.name} draw=true`,
            ];
        }
        case 'ray': {
            // 射线默认水平向右：方向一目了然，不用猜。
            const vertex = makePoint(ax, ay);
            const through = makePoint(right, ay);
            const name = allocate('ray');
            return [
                vertex.command,
                through.command,
                `CREATE RAY name=${name} vertex=${vertex.name} p1=${through.name} draw=true`,
            ];
        }
        case 'circle': {
            const center = makePoint(ax, ay);
            const name = allocate('C');
            return [
                center.command,
                `CREATE CIRCLE name=${name} center=${center.name} radius=${formatNumber(unit)} draw=true`,
            ];
        }
        case 'triangle': {
            // 等边三角形的比例：底边 = unit，高 = unit * √3/2 ≈ 0.87，取 0.85 免得和底边一样宽。
            const a = makePoint(ax, ay);
            const b = makePoint(right, ay);
            const c = makePoint(ax + unit * 0.5, ay + unit * 0.85);
            const name = allocate('tri');
            return [
                a.command,
                b.command,
                c.command,
                `CREATE TRIANGLE name=${name} p1=${a.name} p2=${b.name} p3=${c.name} draw=true`,
            ];
        }
        case 'rectangle':
        case 'square': {
            // 矩形只需要一个顶点 + 宽高，另外两个角由解释器自己算，不用多建点。
            const corner = makePoint(ax, ay);
            const isSquare = spec.kind === 'square';
            const name = allocate(isSquare ? 'sq' : 'rect');
            const width = isSquare ? unit : unit * 1.4;
            return [
                corner.command,
                `CREATE RECTANGLE name=${name} p1=${corner.name} width=${formatNumber(width)} height=${formatNumber(unit)} draw=true`,
            ];
        }
        case 'axis':
            // AXIS/GRID 不是几何对象，范围和步长自动贴合可见区域；再给坐标就是画蛇添足。
            return [`CREATE AXIS name=${allocate('axes')}`];
        case 'grid':
            return [`CREATE GRID name=${allocate('grid')}`];
        case 'text': {
            const text = spec.text;
            if (!text || text.content.trim() === '') return [];
            // TEXT 不是几何对象、也没有名字，直接吃坐标，所以不需要先建落脚点。
            // 内容放在最后（DSL 的 text= 会一直吃到行尾），这样内容里的空格不会把它截断。
            const options: string[] = [];
            if (Number.isFinite(text.fontSize) && text.fontSize > 0) {
                options.push(`fontSize=${formatNumber(text.fontSize)}`);
            }
            if (text.color) options.push(`color=${text.color}`);
            if (text.fontFamily) options.push(`fontFamily="${text.fontFamily}"`);
            const fontStyle = text.italic ? 'italic' : 'normal';
            const fontWeight = text.bold ? 'bold' : 'normal';
            if (fontStyle !== 'normal') options.push(`fontStyle=${fontStyle}`);
            if (fontWeight !== 'normal') options.push(`fontWeight=${fontWeight}`);
            if (text.backgroundColor) options.push(`backgroundColor=${text.backgroundColor}`);
            if (text.backgroundColor && Number.isFinite(text.padding) && text.padding > 0) {
                options.push(`padding=${formatNumber(text.padding)}`);
            }
            const head = `TEXT x=${formatNumber(ax)} y=${formatNumber(ay)}`;
            const stylePart = options.length > 0 ? ` ${options.join(' ')}` : '';
            return [`${head}${stylePart} text="${escapeTextContent(text.content)}"`];
        }
        default:
            return [];
    }
}
