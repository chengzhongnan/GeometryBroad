/**
 * 几何指令名的**唯一权威清单**。
 *
 * 这些名字以前散在三处（`DSLInterpreter` 的 dispatch switch、`HelpCommand.geometricCommands`、
 * 文档），彼此漂移过两次：
 *   - `FUNCTION` / `CURVE` 能用、有文档，却不在清单里 → `HELP CREATE` 看不到它们；
 *   - `ANGLEINTERSECT` 在 switch 和 `OBJECT_DEFINING_COMMANDS` 里，实现却是空方法体
 *     → `CREATE ANGLEINTERSECT` 静默什么都不做。
 *
 * 所以统一放这里，谁要判断「这是不是一个几何指令」都从这里取：
 *   - `DSLInterpreter.parseLine` —— 用它在报错时区分「指令拼错」和「漏了 CREATE」；
 *   - `HelpCommand` —— 用它渲染 `HELP CREATE` 的指令清单。
 *
 * **新增几何指令时这里必须同步加**，否则 `HELP CREATE` 会漏，
 * 且 `meta-command-regression` 里「清单里每个名字都能被 dispatch」的断言会失败。
 */
export const GEOMETRIC_COMMANDS = [
    'POINT', 'LINE', 'SEGMENT', 'RAY', 'MIDPOINT', 'PERPENDICULAR_FOOT',
    'REFLECTED_POINT', 'ROTATED_POINT', 'INTERSECT', 'POINT_ON_LINE',
    'PERP_BISECTOR', 'PERPENDICULAR', 'PARALLEL', 'ANGLE_BISECTOR',
    'CIRCUMCIRCLE', 'INCIRCLE', 'TANGENT', 'POLYGON', 'POINTSET', 'AXIS',
    'GRID', 'REGION', 'TRIANGLE', 'RECTANGLE', 'CIRCLE', 'ELLIPSE',
    'PARABOLA', 'HYPERBOLA', 'ANGLE', 'FOCIS', 'RANDOMPOINT',
    'POINT_ON_CIRCLE', 'CIRCLE_CENTER',
    'SLOT', 'FUNCTION', 'ANIMATION', 'CURVE',
] as const;

const GEOMETRIC_COMMAND_SET: ReadonlySet<string> = new Set<string>(GEOMETRIC_COMMANDS);

/** 判断一个（已大写的）名字是否是几何指令。 */
export function isGeometricCommandName(name: string): boolean {
    return GEOMETRIC_COMMAND_SET.has(name.toUpperCase());
}

/**
 * 元指令的**唯一权威清单** —— 也就是 `HELP` 里逐行列出的那些。
 *
 * 同样漂移过：`TRANSLATE` 只存在于「`isMetaCommand` + `HELP` + 编辑器高亮」三处名单里，
 * 却没有任何实现，`TRANSLATE ...` 会报未知指令；`MESSAGE` 反过来 —— 有实现、有文档
 * （`PRINT` 的别名），却不在名单里。
 */
export const META_COMMANDS = [
    'CLEAR', 'SET', 'HELP', 'VIEW', 'DRAW', 'TEXT', 'FILL', 'MEASURE',
    'RUN', 'CODE', 'WITH', 'CALCULATE', 'GETOBJ', 'PRINT', 'CREATE',
] as const;

/**
 * 解释器接受、但不单独占一行帮助的**别名**。
 *
 * 它们和主名字共用同一段实现，写出来完全合法，只是没必要各占一条帮助：
 *   - `WITHRUN` = `WITH` 的历史拼法；
 *   - `MESSAGE` = `PRINT`（见 DSL_V6.md 的 `PRINT | MESSAGE`）。
 */
export const META_COMMAND_ALIASES = ['WITHRUN', 'MESSAGE'] as const;

/**
 * 解释器实际接受的全部元指令 = 主清单 + 别名。
 *
 * `isMetaCommand` 用它判断，编辑器高亮也用它 —— 高亮的是「写出来不会报错的名字」，
 * 别名当然也算，否则合法的 `MESSAGE` 会被画成普通标识符。
 */
export const ALL_META_COMMANDS = [...META_COMMANDS, ...META_COMMAND_ALIASES] as const;

const META_COMMAND_SET: ReadonlySet<string> = new Set<string>(ALL_META_COMMANDS);

/** 判断一个（已大写的）名字是否是元指令（含别名，含 `CREATE`）。 */
export function isMetaCommandName(name: string): boolean {
    return META_COMMAND_SET.has(name.toUpperCase());
}
