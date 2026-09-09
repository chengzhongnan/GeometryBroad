import { LinearObject } from './geometry/LinearObject';
import {
    GeometricObject,
    type IPoint,
    type DrawOptions,
    Point,
    Circle,
    Ellipse,
    Polygon,
    Line,
    Segment,
    Ray,
    Triangle,
    Rectangle,
    Angle,
    PointNativeObject,
    LinearNativeObject,
    Parabola,
    Hyperbola
} from './geometry/types';

import { calculate } from './expression';
import { getHelpMessages } from './HelpCommand';
import type { CustomFunction } from './types';

interface AnimationState {
    name: string; // 动画名称
    code: string; // 动画帧代码名称，这里必须是通过代码块创建的一个代码块
    slot: string;   // 动画槽位名称，动画的当前帧在这个槽位中
    currentFrame: number; // 当前帧索引
    interval: number; // 帧间隔时间（毫秒）
    isRunning: boolean; // 是否正在运行
    isRepeat: boolean; // 是否循环播放
    animationTimer: number; // 计时器
}

type onMessageCallback = (level: string, line: number, message: string) => void;
type canvasRedrawNotify = (canvas: HTMLCanvasElement) => void;

// DSL解释器的主要状态
interface InterpreterState {
    objects: Map<string, GeometricObject>; // 存储所有已定义的几何对象
    codes: Map<string, ParsedCommand[]>; // 存储代码片段
    slots: Map<string, number | string | Boolean>; // 存储槽位对象，分别为key和value
    animations: Map<string, AnimationState>; // 存储动画对象，key为动画名称，value为动画对象
    functions: Map<string, CustomFunction>; // 函数
    lastCodeName: string | undefined; // 上一个代码片段的名称
    canvas?: HTMLCanvasElement;
    ctx?: CanvasRenderingContext2D;
    defaultOptions: {
        canvasX: number;
        canvasY: number;
        width: number;
        height: number;
        geoColor: string;
        labelColor: string;

        centerX: number;
        centerY: number;
        scale: number;

        backgroundColor: string;
        penColor: string;
        penSize: number;
        labelFont: string;
        labelSize: number;
        pointRadius: number;
        pointFill: boolean;
        drawLabelForPoints: boolean;
        drawLabelForOthers: boolean;
        drawAfterCreate: boolean;
    },
    onMessage?: onMessageCallback; // 消息回调函数
}

// 解析后的指令接口
interface ParsedCommand {
    type: 'meta' | 'geometric';
    command: string;
    params: Map<string, string>;
    rawCommand: string;
    lineNumber: number; // 原始行内容
}

// 几何作图DSL解释器
export class GeometryDSLInterpreter {
    private state: InterpreterState;
    private zeroThresholdValue: number = 1e-6;

    constructor(canvas?: HTMLCanvasElement, onMessage?: onMessageCallback) {
        this.state = {
            objects: new Map(),
            codes: new Map(),
            slots: new Map(),
            animations: new Map(),
            functions: new Map(),
            lastCodeName: undefined,
            canvas,
            ctx: canvas?.getContext('2d') || undefined,
            defaultOptions: {
                canvasX: 0,
                canvasY: 0,
                width: canvas ? canvas.width : 0,
                height: canvas ? canvas.height : 0,
                geoColor: 'black',
                labelColor: 'white',

                centerX: 0,
                centerY: 0,
                scale: 1,

                backgroundColor: 'white',
                penColor: 'black',
                penSize: 1,
                labelFont: '12px Arial',
                labelSize: 12,
                pointRadius: 3,
                pointFill: true,
                drawLabelForPoints: true,
                drawLabelForOthers: false,
                drawAfterCreate: false,
            },
            onMessage: onMessage,
        };
    }

    private addCommand(name: string, rawLine: string, command: ParsedCommand | null, lineNumber: number): void {
        if (!command) {
            console.error(`Failed to parse code block at line ${lineNumber}: ${rawLine}`);
            this.state.onMessage?.('error', lineNumber, `Failed to parse code block at line ${lineNumber}: ${rawLine}`);

            return;
        }

        this.state.codes.get(name)?.push({
            type: command.type,
            command: command.command,
            params: command.params,
            rawCommand: rawLine,
            lineNumber: lineNumber
        });
    }

    private executeLines(lines: string[], setLineNumber: boolean): void {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 跳过空行和注释
            if (!line || line.startsWith('#')) {
                continue;
            }

            // 以[开头的行表示代码片段，以]结尾的行表示代码片段结束
            if (line.startsWith('[')) {
                // 不允许在代码块中再包含代码块
                if (!setLineNumber) {
                    console.error(`Nested code blocks are not allowed at line ${i + 1}: ${line}`);
                    this.state.onMessage?.('error', i + 1, `Nested code blocks are not allowed at line ${i + 1}: ${line}`);
                }

                // 使用lastCodeName创建代码段
                const code = line.slice(1).trim();

                if (this.state.lastCodeName && code) {
                    const command = this.parseLine(line, setLineNumber ? i + 1 : -1);
                    this.addCommand(this.state.lastCodeName, line, command, i + 1);
                }
                continue;
            } else if (line.endsWith(']')) {
                // 代码片段结束
                this.state.lastCodeName = undefined;
                continue;
            }

            try {
                if (this.state.lastCodeName) {
                    // 如果当前行在代码片段中，添加到当前代码片段
                    const command = this.parseLine(line, setLineNumber ? i + 1 : -1);
                    this.addCommand(this.state.lastCodeName, line, command, i + 1);
                } else {
                    // 否则执行当前行指令
                    const command = this.parseLine(line, setLineNumber ? i + 1 : -1);
                    if (command) {
                        this.executeCommand(command);
                    }
                }

            } catch (error) {
                console.error(`Error executing line ${i + 1}: ${line}`, error);
                this.state.onMessage?.('error', i + 1, `Error executing line ${i + 1}: ${line} - ${error}`);
            }
        }
    }

    // 主要的解析和执行函数
    public execute(script: string): void {
        // 清空state中的命令和slot
        this.state.codes.clear();
        // 清空动画计时器
        this.state.animations.forEach((v, k) => {
            if (v.animationTimer > 0) {
                clearTimeout(v.animationTimer);
                v.animationTimer = 0;
            }
        })
        this.state.animations.clear();
        this.state.lastCodeName = undefined;
        this.state.objects.clear();
        this.state.slots.clear();
        this.state.functions.clear();

        const lines = script.split('\n');
        this.executeLines(lines, true);
    }

    public setTransform(canvas: HTMLCanvasElement, transform: { x: number; y: number; scale: number; }) {
        this.state.canvas = canvas;

        // 计算变换以后左上角的坐标
        this.state.defaultOptions.canvasX = -transform.x / transform.scale;
        this.state.defaultOptions.canvasY = -transform.y / transform.scale;

        // 计算变换后的宽高
        this.state.defaultOptions.width = canvas.width / transform.scale;
        this.state.defaultOptions.height = canvas.height / transform.scale;
    }

    private isMetaCommand(cmd: string, includeCreate: boolean = false): boolean {
        const metaCommands = ['CLEAR', 'SET', 'HELP', 'VIEW', 'TRANSLATE', 'DRAW', 'MEASURE', 'RUN', 'CODE', 'WITH', 'CALCULATE', 'GETOBJ', 'PRINT', 'MESSAGE'];
        if (includeCreate) {
            metaCommands.push('CREATE');
        }
        return metaCommands.includes(cmd.toUpperCase());
    }

    // 解析单行指令
    private parseLine(line: string, lineNumber: number): ParsedCommand | null {
        try {
            // 移除多余的空格
            line = line.trim();
            if (!line) return null;

            // 去掉# 后面的内容
            const commentIndex = line.indexOf('#');
            if (commentIndex !== -1) {
                line = line.substring(0, commentIndex);
                line = line.trim();
                if (!line) return null;
            }

            // 分离指令和参数
            const parts = line.split(/\s+/);
            if (parts.length === 0) return null;

            const firstPart = parts[0].toUpperCase();

            // 判断是否为元指令，所有的几何指令都是跟随在CREATE这个元指令之后，所以以下数组需要排除CREATE

            const metaCommand = this.isMetaCommand(firstPart);

            let command: string;
            let paramString: string;

            if (metaCommand) {
                command = firstPart;
                paramString = parts.slice(1).join(' ');
            } else {
                // 几何指令，需要从元指令上下文中提取
                const secondPart = parts[1].toUpperCase();
                if (!secondPart) {
                    return null;
                }
                command = secondPart;
                paramString = parts.slice(2).join(' ');
            }

            // 解析参数
            const params = this.parseParameters(paramString);

            return {
                type: metaCommand ? 'meta' : 'geometric',
                command,
                params,
                rawCommand: line,
                lineNumber
            };
        } catch (error) {
            console.error(`Failed to parse line: ${line}, at line ${lineNumber}: `, error);
            this.state.onMessage?.('error', lineNumber, `Failed to parse line: ${line}, at line ${lineNumber}: ${error}`);
            return null;
        }
    }

    // 解析参数字符串为键值对
    private parseParameters(paramString: string): Map<string, string> {
        const params = new Map<string, string>();

        // 匹配 key=value 格式的参数
        const paramRegex = /(\w+)=([^=\s]+(?:\s+[^=\s]+)*?)(?=\s+\w+=|$)/g;
        let match;

        while ((match = paramRegex.exec(paramString)) !== null) {
            const key = match[1];
            let value = match[2].trim();

            // 处理引号包围的值
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            params.set(key, value);
        }

        return params;
    }

    // 执行解析后的指令
    private executeCommand(command: ParsedCommand): void {
        if (command.type === 'meta') {
            this.executeMetaCommand(command.command.toUpperCase(), command.params, command.rawCommand, command.lineNumber);
        } else {
            this.executeGeometricCommand(command.command.toUpperCase(), command.params);
        }
    }

    // 执行元指令
    private executeMetaCommand(command: string, params: Map<string, string>, rawCommand: string, lineNumber: number): void {
        switch (command.toUpperCase()) {
            case 'SET':
                this.executeSetOptions(params);
                break;
            case 'HELP':
                this.executeHelp(params, lineNumber);
                break;
            case 'CLEAR':
                this.executeClear(params);
                break;
            case 'VIEW':
                this.executeView(params);
                break;
            case 'DRAW':
                this.executeDraw(params);
                break;
            case 'MEASURE':
                this.executeMeasure(params);
                break;
            case 'RUN':
                this.executeRunCommands(params);
                break;
            case 'CODE':
                this.createCodeBlock(params);
                break;
            case 'WITHRUN':
                this.executeWithRun(params);
                break;
            case 'GETOBJ':
                this.executeGetObject(params);
                break;
            case 'CALCULATE':
                this.executeCalculate(params);
                break;
            case 'PRINT':
            case 'MESSAGE':
                this.executePrint(params, rawCommand, lineNumber);
                break;
            default:
                throw new Error(`Unknown meta command: ${command}`);
        }
    }

    // 执行几何指令
    private executeGeometricCommand(command: string, params: Map<string, string>): void {
        switch (command.toUpperCase()) {
            case 'POINT':
                this.createPoint(params);
                break;
            case 'LINE':
                this.createLine(params);
                break;
            case 'SEGMENT':
                this.createSegment(params);
                break;
            case 'RAY':
                this.createRay(params);
                break;
            case 'MIDPOINT':
                this.createMidpoint(params);
                break;
            case 'PERPENDICULAR_FOOT':
                this.createPerpendicularFoot(params);
                break;
            case 'REFLECTED_POINT':
                this.createReflectedPoint(params);
                break;
            case 'ROTATED_POINT':
                this.createRotatedPoint(params);
                break;
            case 'INTERSECT':
                this.createIntersection(params);
                break;
            case 'ANGLEINTERSECT':
                this.createAngleIntersection(params);
                break;
            case 'POINT_ON_LINE':
                this.createPointOnLine(params);
                break;
            case 'PERP_BISECTOR':
                this.createPerpBisector(params);
                break;
            case 'PERPENDICULAR':
                this.createPerpendicular(params);
                break;
            case 'PARALLEL':
                this.createParallel(params);
                break;
            case 'ANGLE_BISECTOR':
                this.createAngleBisector(params);
                break;
            case 'CIRCUMCIRCLE':
                this.createCircumcircle(params);
                break;
            case 'INCIRCLE':
                this.createIncircle(params);
                break;
            case 'TANGENT':
                this.createTangent(params);
                break;
            case 'POLYGON':
                this.createPolygon(params);
                break;
            case 'TRIANGLE':
                this.createTriangle(params);
                break;
            case 'RECTANGLE':
                this.createRectangle(params);
                break;
            case 'CIRCLE':
                this.createCircle(params);
                break;
            case 'ELLIPSE':
                this.createEllipse(params);
                break;
            case 'PARABOLA':
                this.createParabola(params);
                break;
            case 'HYPERBOLA':
                this.createHyperbola(params);
                break;
            case 'ANGLE':
                this.createAngle(params);
                break;
            case 'FOCIS':
                this.createFocis(params);
                break;
            case 'RANDOMPOINT':
                this.createRandomPoint(params);
                break;
            case 'SLOT':
                this.createSlot(params);
                break;
            case 'FUNCTION':
                this.createFunction(params);
                break;
            case 'ANIMATION':
                this.createAnimation(params);
                break;
            case 'CURVE':
                this.createCurve(params);
                break;
            default:
                throw new Error(`Unknown geometric command: ${command}`);
        }
    }

    // 元指令清空画板
    private executeClear(params: Map<string, string>): void {
        const color = this.parseColor(params, 'color') || this.parseColor(params, 'c') || this.state.defaultOptions.penColor;
        const geoColor = this.parseColor(params, 'getColor') || this.parseColor(params, 'g') || this.state.defaultOptions.geoColor;
        const labelColor = this.parseColor(params, 'labelColor') || this.parseColor(params, 'l') || this.state.defaultOptions.labelColor;

        // 确认我们有 canvas 的 2D 渲染上下文 (context)
        if (this.state.ctx) {
            const ctx = this.state.ctx;
            const canvas = this.state.canvas!; // 使用非空断言操作符

            this.state.defaultOptions.geoColor = geoColor;
            this.state.defaultOptions.labelColor = labelColor;

            // 1. 保存当前 canvas 状态 (可选，但推荐)
            // 这可以防止本次颜色设置影响到后续的绘制操作
            ctx.save();

            // 2. 设置填充颜色
            // 将 fillStyle 设置为您想要用来清空画布的颜色
            ctx.fillStyle = color;

            // 3. 绘制一个覆盖整个 canvas 的矩形
            // fillRect(x, y, width, height)
            ctx.fillRect(this.state.defaultOptions.canvasX, this.state.defaultOptions.canvasY, this.state.defaultOptions.width, this.state.defaultOptions.height);

            // 4. 恢复之前保存的 canvas 状态 (可选，但推荐)
            ctx.restore();
        }
    }

    // 设置属性
    private executeSetOptions(params: Map<string, string>): void {
        const item = params.get('item');
        const value = params.get('value');

        if (!item || value === undefined) {
            throw new Error('SET command requires "item" and "value" parameters.');
        }

        let isUnKnownCmd = false;

        try {
            switch (item.toLowerCase()) {
                case 'backgroundcolor':
                    this.state.defaultOptions.backgroundColor = value;
                    break;
                case 'pencolor':
                    if (this.parseColor(params, value)) {
                        this.state.defaultOptions.penColor = this.parseColor(params, value)!;
                    }
                    break;
                case 'pensize':
                    this.state.defaultOptions.penSize = parseFloat(value);
                    break;
                case 'labelfont':
                    this.state.defaultOptions.labelFont = value;
                    break;
                case 'labelcolor':
                    if (this.parseColor(params, value)) {
                        this.state.defaultOptions.labelColor = this.parseColor(params, value)!;
                    }
                    break;
                case 'labelsize':
                    this.state.defaultOptions.labelSize = parseFloat(value);
                    break;
                case 'pointradius':
                    this.state.defaultOptions.pointRadius = parseFloat(value);
                    break;
                case 'pointfill':
                    this.state.defaultOptions.pointFill = GeometryDSLInterpreter.parseBoolean(value);
                    break;
                case 'drawlabelforpoints':
                    this.state.defaultOptions.drawLabelForPoints = GeometryDSLInterpreter.parseBoolean(value);
                    break;
                case 'drawlabelforothers':
                    this.state.defaultOptions.drawLabelForOthers = GeometryDSLInterpreter.parseBoolean(value);
                    break;
                case 'drawaftercreate':
                    this.state.defaultOptions.drawAfterCreate = GeometryDSLInterpreter.parseBoolean(value);
                    break;
                case 'geocolor':
                    this.state.defaultOptions.geoColor = value;
                    break;
                case 'centerx':
                    this.state.defaultOptions.canvasX = parseFloat(value);
                    break;
                case 'centery':
                    this.state.defaultOptions.canvasY = parseFloat(value);
                    break;
                case 'scale':
                    this.state.defaultOptions.scale = parseFloat(value);
                    break;

                default:
                    isUnKnownCmd = true;
                    throw new Error(`Unknown setting item: ${item}`);
            }
        }
        catch (error: any) {
            if (isUnKnownCmd) {
                throw error;
            }

            throw new Error(`set option ${item} fail, your value ${value} is invalid`);
        }

        // 可选：向用户反馈设置成功
        this.state.onMessage?.('info', 0, `Set ${item} to ${value}`);
    }

    // 帮助信息
    private executeHelp(params: Map<string, string>, line: number): void {
        let message: string = '';
        if (params.size == 0) {
            message = getHelpMessages('', '');
        }

        const cmd = params.get('cmd') || params.get('command') || params.get('c');
        if (cmd == null) {
            message = getHelpMessages('', '');
        } else {
            if (this.isMetaCommand(cmd, true)) {
                message = getHelpMessages(cmd, '');
            } else {
                message = getHelpMessages('', cmd);
            }
        }

        if (this.state.onMessage) {
            this.state.onMessage('info', line, message);
        }
    }

    private executeView(params: Map<string, string>): void {
        if (params.has('centerX')) {
            const centerX = this.getNumberValue(params, 'centerX')
            if (centerX === undefined) {
                throw new Error('VIEW command requires centerX parameter');
            }
            this.state.defaultOptions.centerX = centerX;
        }
        if (params.has('centerY')) {
            const centerY = this.getNumberValue(params, 'centerY')
            if (centerY === undefined) {
                throw new Error('VIEW command requires centerY parameter');
            }
            this.state.defaultOptions.centerY = centerY;
        }
        if (params.has('scale')) {
            const scale = this.getNumberValue(params, 'scale');
            if (scale === undefined || isNaN(scale) || Math.abs(scale) < this.zeroThresholdValue) {
                throw new Error('VIEW command requires scale parameter');
            }
            this.state.defaultOptions.scale = scale;
        }
    }

    private drawObject(ctx: CanvasRenderingContext2D, params: Map<string, string>, obj: GeometricObject, label: string | undefined): void {
        // 解析绘制选项
        const options: DrawOptions = {};
        if (params.has('color')) options.color = this.parseColor(params, 'color') || this.parseColor(params, 'c') || this.state.defaultOptions.geoColor;
        if (params.has('width')) options.lineWidth = this.getNumberValue(params, 'width') || this.getNumberValue(params, 'w') || 1; // 默认线宽为1
        if (params.has('fill')) options.fillColor = this.parseColor(params, 'fill') || this.parseColor(params, 'f') || this.state.defaultOptions.backgroundColor;
        if (params.has('style') && params.get('style') === 'dashed') options.dashed = true;
        if (params.has('s') && params.get('s') === 'dashed') options.dashed = true;

        // 计算变换参数
        const transform = {
            scale: this.state.defaultOptions.scale,
            offsetX: this.state.canvas!.width / 2 - this.state.defaultOptions.centerX * this.state.defaultOptions.scale,
            offsetY: this.state.canvas!.height / 2 - this.state.defaultOptions.centerY * this.state.defaultOptions.scale
        };

        obj.draw(ctx, transform, options);

        // 处理标签
        if (label != null || params.has('label') || params.has('l')) {
            const _label = label || params.get('label') || params.get('l');
            this.drawLabel(obj, _label!, params, transform);
        }
    }

    private executeDraw(params: Map<string, string>): void {
        const objName = params.get('obj');
        if (!objName) {
            throw new Error('DRAW command requires obj parameter');
        }

        const names = objName.split(',')

        for (let name of names) {
            name = name.trim();
            const obj = this.getObject(name);
            if (!obj) {
                throw new Error(`Object ${name} not found`);
            }

            if (!this.state.ctx) {
                throw new Error('No canvas context available for drawing');
            }

            this.drawObject(this.state.ctx, params, obj, undefined);
        }
    }

    private executeMeasure(params: Map<string, string>): void {
        const type = params.get('type') || params.get('t') || 'length';
        let value = 0;
        switch (type.toLowerCase()) {
            case 'distance':
            case 'length':
            case 'd':
                value = this.measureDistance(params);
                break;
            case 'angle':
                value = this.measureAngle(params);
                break;
            case 'area':
                value = this.measureArea(params);
                break;
        }

        const slot = params.get('slot') || params.get('s');
        if (slot) {
            this.state.slots.set(slot, value);
            console.log(`Measured value for ${type} stored in slot ${slot}: ${value}`);
        }
    }

    private measureDistance(params: Map<string, string>): number {
        const objName = params.get('obj') || params.get('o');

        if (!objName) {
            const p1Name = params.get('p1') || params.get('point1');
            const p2Name = params.get('p2') || params.get('point2');

            if (!p1Name || !p2Name) {
                throw new Error('Distance measurement requires p1 and p2 parameters for Point objects');
            }

            const p1 = this.getObject(p1Name);
            const p2 = this.getObject(p2Name);

            if (!p1 || !p2) {
                throw new Error(`Points ${p1Name} or ${p2Name} not found`);
            }

            if (!(p1 instanceof Point) || !(p2 instanceof Point)) {
                throw new Error(`Distance measurement is only supported for Point objects`);
            }

            // 计算两个点的距离
            return p1.distanceTo(p2);

        } else {
            const obj = this.getObject(objName);
            if (!obj) {
                throw new Error(`Object ${objName} not found`);
            }

            if (!(obj instanceof Segment)) {
                throw new Error(`Distance measurement is only supported for Point objects`);
            }

            // 如果是线段对象，直接返回线段长度
            return obj.length;
        }
    }

    private measureAngle(params: Map<string, string>): number {
        const objName = params.get('obj') || params.get('o');
        if (objName) {
            // --- 模式一: 直接测量一个Angle对象 ---
            const obj = this.getObject(objName);
            if (!obj) {
                throw new Error(`Object ${objName} not found`);
            }
            if (!(obj instanceof Angle)) {
                throw new Error(`Angle measurement via 'obj' parameter is only supported for Angle objects`);
            }

            // 如果是角度对象，直接返回角度值（从弧度转换为度）
            return (obj.value * 180) / Math.PI;
        }

        // --- 模式二: 由一个顶点和两个其他点形成角 ---
        const vertexName = params.get('vertex') || params.get('v');
        if (vertexName) {
            const p1Name = params.get('p1');
            const p2Name = params.get('p2');

            if (p1Name == null || p2Name == null) {
                throw new Error('Angle measurement by vertex requires p1 and p2 parameters.');
            }

            const vertex = this.getObject(vertexName);
            const p1 = this.getObject(p1Name);
            const p2 = this.getObject(p2Name);

            if (!vertex || !(vertex instanceof Point) || !p1 || !(p1 instanceof Point) || !p2 || !(p2 instanceof Point)) {
                throw new Error(`Invalid points provided for angle measurement. Check if ${vertexName}, ${p1Name}, ${p2Name} are valid points.`);
            }

            // 计算从顶点到p1和p2的两个向量
            const v1x = p1.x - vertex.x;
            const v1y = p1.y - vertex.y;
            const v2x = p2.x - vertex.x;
            const v2y = p2.y - vertex.y;

            // 计算点积
            const dotProduct = v1x * v2x + v1y * v2y;
            // 计算两个向量的模（长度）
            const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

            // 如果任意一个向量长度为0，则角度为0
            if (mag1 === 0 || mag2 === 0) {
                return 0;
            }

            // 计算夹角的余弦值: cos(θ) = (v1 · v2) / (|v1| * |v2|)
            let cosTheta = dotProduct / (mag1 * mag2);

            // 处理浮点数精度误差，确保cosTheta在[-1, 1]范围内
            cosTheta = Math.max(-1, Math.min(1, cosTheta));

            // 计算弧度并转换为度数后返回
            const angleRad = Math.acos(cosTheta);
            return angleRad * (180 / Math.PI);
        }

        // --- 模式三: 由两条直线形成夹角 ---
        const line1Name = params.get('obj1') || params.get('line1') || params.get('l1');
        const line2Name = params.get('obj2') || params.get('line2') || params.get('l2'); // 修正了这里的笔误
        if (line1Name && line2Name) {
            const line1 = this.getObject(line1Name);
            const line2 = this.getObject(line2Name);

            if (!line1 || !(line1 instanceof LinearObject) || !line2 || !(line2 instanceof LinearObject)) {
                throw new Error(`Invalid lines provided for angle measurement. Check if ${line1Name} and ${line2Name} are valid lines.`);
            }

            // 获取两条线的方向向量
            const v1x = line1.p2.x - line1.p1.x;
            const v1y = line1.p2.y - line1.p1.y;
            const v2x = line2.p2.x - line2.p1.x;
            const v2y = line2.p2.y - line2.p1.y;

            // 计算点积
            const dotProduct = v1x * v2x + v1y * v2y;
            // 计算两个向量的模（长度）
            const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

            if (mag1 === 0 || mag2 === 0) {
                return 0; // 如果其中一条线是无效的（长度为0），则夹角为0
            }

            // 计算夹角余弦值。取点积的绝对值以确保我们得到的是锐角（或直角）。
            const cosTheta = Math.abs(dotProduct) / (mag1 * mag2);

            // 处理浮点数精度误差
            const clampedCosTheta = Math.max(-1, Math.min(1, cosTheta));

            const angleRad = Math.acos(clampedCosTheta);
            return angleRad * (180 / Math.PI);
        }

        // 如果以上模式都不匹配，则抛出错误
        throw new Error('To measure an angle, provide an Angle object, or a vertex with two points, or two lines.');
    }

    private measureArea(params: Map<string, string>): number {
        const objName = params.get('obj');
        if (!objName) {
            throw new Error('MEASURE AREA command requires obj parameter');
        }
        const obj = this.getObject(objName);
        if (obj instanceof Polygon) {
            // 如果是多边形对象，返回面积
            return obj.area;
        }

        if (obj instanceof Circle) {
            // 如果是圆对象，返回面积
            return Math.PI * obj.radius * obj.radius;
        }

        if (obj instanceof Ellipse) {
            // 如果是椭圆对象，返回面积
            return Math.PI * obj.rx * obj.ry;
        }

        throw new Error(`Area measurement is only supported for Polygon and Circle objects`);
    }

    // 执行一段指令
    private executeRunCommands(params: Map<string, string>): void {
        const codeName = params.get('code');
        if (!codeName) {
            throw new Error('RUN command requires code parameter');
        }

        const commands = this.state.codes.get(codeName);
        if (!commands) {
            throw new Error(`Code ${codeName} not found`);
        }

        // 执行代码片段
        this.executeLines(commands.map(x => x.rawCommand), false);
    }

    // 创建代码块
    private createCodeBlock(params: Map<string, string>): void {
        const blockName = params.get('name');
        if (!blockName) {
            throw new Error('BLOCK command requires name parameter');
        }

        // 如果已经存在同名代码块，则覆盖
        this.state.lastCodeName = blockName;
        this.state.codes.set(blockName, []);
        console.log(`Created code block: ${blockName}`);
    }

    // 执行WITHRUN指令
    private executeWithRun(params: Map<string, string>): void {
        const codeName = params.get('code') || params.get('c');
        const withSlot = params.get('with') || params.get('w');
        if (!codeName || !withSlot) {
            throw new Error('WITH command requires code parameter');
        }

        const commands = this.state.codes.get(codeName);
        if (!commands) {
            throw new Error(`Code ${codeName} not found`);
        }

        const withValue = this.getNumberValue(params, 'with') || this.getNumberValue(params, 'w');
        if (withValue === undefined || isNaN(withValue) || Math.abs(withValue) < this.zeroThresholdValue) {
            return;
        }

        // 执行代码片段
        this.executeLines(commands.map(x => x.rawCommand), false);
    }

    /**
     * 从一个目标中获取对象获取某个属性，获取到该对象以后，将其name放入到slot中
     * @param params 
     */
    private executeGetObject(params: Map<string, string>): void {
        const objName = params.get('name') || params.get('n') || params.get('object') || params.get('o');
        if (!objName) {
            throw new Error('GETOBJ command requires name parameter');
        }

        const propertyName = params.get('property') || params.get('p');
        if (!propertyName) {
            throw new Error('GETOBJ command requires property parameter');
        }

        const slotName = params.get('slot') || params.get('s');
        if (!slotName) {
            throw new Error('GETOBJ command requires slot parameter');
        }

        // 检查对象是否存在
        const obj = this.getObject(objName);
        if (!obj) {
            throw new Error(`Object ${objName} not found`);
        }

        // 获取对象的属性值
        if (!(propertyName in obj)) {
            throw new Error(`Property ${propertyName} does not exist on object ${objName}`);
        }

        const value = (obj as any)[propertyName]; // 使用类型断言获取属性值

        // 判断目标对象是否是几何对象
        if (value instanceof GeometricObject) {
            const valueName = (value as any).name; // 获取属性的name
            // 将对象的name存入槽位
            this.state.slots.set(slotName, valueName);

            // 输出对象信息
            console.log(`Retrieved object: ${objName}`, obj);
        } else {
            // 如果是数值，字符串，Boolean，直接存入槽位
            if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
                this.state.slots.set(slotName, value);
                // console.log(`Stored value '${value}' in slot ${slotName}`);
            }
        }
    }

    // 执行计算指令
    private executeCalculate(params: Map<string, string>): void {
        const expression = params.get('expression') || params.get('e');
        if (!expression) {
            throw new Error('CALCULATE command requires expression parameter');
        }

        // 解析表达式
        const result = this.executeSlotExpression(expression);
        const slotName = params.get('slot') || params.get('s');
        if (slotName) {
            this.state.slots.set(slotName, result);
        }

        // console.log(`Calculated value for expression '${expression}' stored in slot ${slotName}: ${result}`);
    }

    /**
     * 提取字符串中的所有嵌套表达式，表达式以 { 和 } 包围，支持多层嵌套。
     * 如果遇到不完整的平衡组，左边的 '{' 会被当作普通字符处理。
     *
     * @param {string} text 需要解析的原始字符串。
     * @returns {string[]} 包含所有提取出的完整表达式的字符串数组。
     */
    extractExpressions(text: string): string[] {
        const expressions: string[] = [];
        const stack: number[] = [];
        let start = -1;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '{') {
                if (stack.length === 0) {
                    // 找到一个潜在的表达式起点
                    start = i;
                }
                stack.push(i);
            } else if (char === '}') {
                if (stack.length > 0) {
                    const openIndex = stack.pop();
                    if (stack.length === 0) {
                        // 找到一个完整的顶层表达式
                        expressions.push(text.substring(start, i + 1));
                        start = -1; // 重置开始位置
                    }
                } else {
                    // 如果没有匹配的左括号，当前 '}' 会被忽略
                }
            }
        }
        return expressions;
    }

    private executePrint(params: Map<string, string>, rawCommand: string, lineNumber: number): void {
        // 从原始命令中获取message=开头或者m=开头后面所有的字符串(需要忽略message或者m的大小写)，这里由于需要支持空格，所以不能使用params解析
        const reg = /\b(message|m)=(.*)/i
        const messageMatch = reg.exec(rawCommand);
        if (!messageMatch) {
            return;
        }

        let message = messageMatch[2];
        // 这里需要处理表达式中的内容
        const expressMatchs = this.extractExpressions(message)
        if (expressMatchs.length > 0) {
            expressMatchs.forEach(slot => {
                const slotName = slot.slice(1, -1); // 去掉{}
                const slotValue = this.executeSlotExpression(slotName); // 解析槽位表达式
                if (slotValue !== undefined) {
                    message = message.replace(slot, slotValue.toString());
                } else {
                    console.warn(`Slot ${slotName} not found in message at line ${lineNumber}`);
                }
            });
        }

        // 输出消息
        console.log(`Print at line ${lineNumber}: ${message}`);
        this.state.onMessage?.('info', lineNumber, message);
    }

    private static parseBoolean(value: string | undefined): boolean {
        if (value === undefined) return false;
        return value.toLowerCase() === 'true';
    }

    private executeSlotExpression(expression: string): number {
        // 解析槽位表达式，支持简单的加减乘除

        // 处理表达式中存在的负号，在前面加一个0，例如 -3 + (6 * (-{x} + 2 * 3)) ，替换成 0 - 3 + (6 * (0- {x} + 2 * 3))
        expression = expression.replace(/(^|\()\s*-\s*/g, '$10 - ');

        return calculate(expression, this.state.slots, this.state.functions);
    }

    private getNumberValue(params: Map<string, string>, key: string): number | undefined {
        const value = params.get(key);
        if (value === undefined) {
            return undefined; // 如果没有提供该参数，则返回undefined
        }

        // 如果值是一个槽位表达式{slot}，解析它
        if (value.startsWith('{') && value.endsWith('}')) {
            const slotExpression = value.slice(1, -1);

            const slotValue = this.executeSlotExpression(slotExpression);
            return slotValue;
        }

        const num = parseFloat(value);
        if (isNaN(num)) {
            return undefined;
        }
        return num;
    }

    // 几何指令实现示例（需要根据实际的几何对象类来实现）
    private createPoint(params: Map<string, string>): void {
        const name = params.get('name');
        const x = this.getNumberValue(params, 'x') || 0; // 默认值为0
        const y = this.getNumberValue(params, 'y') || 0; // 默认值为0
        const radius = this.getNumberValue(params, 'radius') || 1; // 默认半径为1
        const real = GeometryDSLInterpreter.parseBoolean(params.get('real'));

        if (!name) {
            throw new Error('POINT command requires name parameter');
        }

        // 这里需要创建实际的Point对象
        const point = new Point(name, x, y, radius, real);
        this.state.objects.set(name, point);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, point, name);
        }
    }

    private createLine(params: Map<string, string>): void {
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');

        if (!name || !p1Name || !p2Name) {
            throw new Error('LINE command requires name, p1, and p2 parameters');
        }

        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);

        if (!p1 || !p2) {
            throw new Error(`Points ${p1Name} or ${p2Name} not found`);
        }

        // 这里需要创建实际的Line对象
        const line = new Line(name, p1 as Point, p2 as Point);
        this.state.objects.set(name, line);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, line, undefined);
        }
    }

    private createSegment(params: Map<string, string>): void {
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');

        if (!name || !p1Name || !p2Name) {
            throw new Error('SEGMENT command requires name, p1, and p2 parameters');
        }

        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);

        if (!p1 || !p2) {
            throw new Error(`Points ${p1Name} or ${p2Name} not found`);
        }

        // 这里需要创建实际的Segment对象
        const segment = new Segment(name, p1 as Point, p2 as Point);
        this.state.objects.set(name, segment);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, segment, undefined);
        }
    }

    // 创建射线
    private createRay(params: Map<string, string>): void {
        // 实现射线创建
        const name = params.get('name');
        // 顶点
        const vertexName = params.get('vertex') || params.get('v');
        // 其他任意一点
        const p1Name = params.get('p1');

        if (!name || !vertexName || !p1Name) {
            throw new Error('RAY command requires name, vertex, and p1 parameters');
        }

        const vertex = this.getObject(vertexName);
        const p1 = this.getObject(p1Name);

        if (!vertex || !p1) {
            throw new Error(`Points ${vertexName} or ${p1Name} not found`);
        }

        // 这里需要创建实际的Ray对象
        const ray = new Ray(name, vertex as Point, p1 as Point);
        this.state.objects.set(name, ray);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, ray, undefined);
        }
    }

    private createMidpoint(params: Map<string, string>): void {
        // 实现中点创建
        const name = params.get('name') || params.get('n');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');

        if (!name || !p1Name || !p2Name) {
            throw new Error('MIDPOINT command requires name, p1, and p2 parameters');
        }

        const p1Raw = this.getObject(p1Name);
        const p2Raw = this.getObject(p2Name);

        if (!p1Raw || !p2Raw) {
            throw new Error(`Points ${p1Name} or ${p2Name} not found`);
        }

        const p1 = p1Raw as Point;
        const p2 = p2Raw as Point;

        // 计算中点坐标
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        // 这里需要创建实际的Point对象作为中点
        const midpoint = new Point(name, midX, midY);
        this.state.objects.set(name, midpoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, midpoint, name);
        }
    }

    private createPerpendicularFoot(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        const pointName = params.get('point') || params.get('p');
        const lineName = params.get('obj') || params.get('o') || params.get('line');

        if (!name || !pointName || !lineName) {
            throw new Error('PerpendicularFoot need name, point and line');
        }

        const point = this.getObject(pointName);
        const line = this.getObject(lineName);

        if (!point || !(point instanceof Point)) {
            throw new Error(`invalid point name : ${pointName}`);
        }

        if (!line || !(line instanceof LinearObject)) {
            throw new Error(`invalid line name : ${lineName}`);
        }

        // --- 以下是核心计算逻辑 ---

        // 1. 定义代表直线的向量 (v = p2 - p1)
        const vx = line.p2.x - line.p1.x;
        const vy = line.p2.y - line.p1.y;

        // 2. 定义从直线上一点p1指向源点的向量 (w = point - p1)
        const wx = point.x - line.p1.x;
        const wy = point.y - line.p1.y;

        // 3. 计算 w 在 v 上的投影长度比例 t
        // t = (w · v) / |v|²
        const dotProduct = (wx * vx) + (wy * vy);
        const lenSq = (vx * vx) + (vy * vy);

        // 如果lenSq为0，说明line的两个端点重合，垂足就是那个点
        const t = (lenSq === 0) ? 0 : dotProduct / lenSq;

        // 4. 计算垂足坐标 F = p1 + t * v
        const footX = line.p1.x + t * vx;
        const footY = line.p1.y + t * vy;

        // 5. 创建并存储新的垂足点对象
        const footPoint = new Point(name, footX, footY);
        this.state.objects.set(name, footPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, footPoint, name);
        }
    }

    private createReflectedPoint(params: Map<string, string>): void {
        // 1. 解析通用参数 (新点名称, 被操作的对象名称)
        const name = params.get('name') || params.get('n');
        const objName = params.get('obj') || params.get('o');

        if (!name || !objName) {
            throw new Error('ReflectedPoint requires a "name" and an "obj" to reflect.');
        }

        const objToReflect = this.getObject(objName);
        if (!objToReflect || !(objToReflect instanceof Point)) {
            throw new Error(`Object to reflect must be a valid point: ${objName}`);
        }

        // 2. 检查是中心对称还是轴对称
        const centerName = params.get('center') || params.get('c');
        const axisName = params.get('axis') || params.get('a');

        if (centerName) {
            // --- 情况一: 中心对称 ---
            const centerPoint = this.getObject(centerName);
            if (!centerPoint || !(centerPoint instanceof Point)) {
                throw new Error(`Center of reflection must be a valid point: ${centerName}`);
            }

            // 对称点 P' = C + (C - P) = 2C - P
            const reflectedX = 2 * centerPoint.x - objToReflect.x;
            const reflectedY = 2 * centerPoint.y - objToReflect.y;

            const reflectedPoint = new Point(name, reflectedX, reflectedY);
            this.state.objects.set(name, reflectedPoint);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, reflectedPoint, name);
            }

        } else if (axisName) {
            // --- 情况二: 轴对称 ---
            const axisLine = this.getObject(axisName);
            if (!axisLine || !(axisLine instanceof LinearObject)) {
                throw new Error(`Axis of reflection must be a valid line: ${axisName}`);
            }

            // 轴对称的几何意义是：先找到从源点到对称轴的垂足 F，
            // 然后新点 P' 就是源点 P 关于垂足 F 的中心对称点。

            // 步骤 A: 计算垂足 F 的坐标 (使用向量投影法)
            const vx = axisLine.p2.x - axisLine.p1.x;
            const vy = axisLine.p2.y - axisLine.p1.y;
            const wx = objToReflect.x - axisLine.p1.x;
            const wy = objToReflect.y - axisLine.p1.y;

            const dotProduct = (wx * vx) + (wy * vy);
            const lenSq = (vx * vx) + (vy * vy);
            const t = (lenSq === 0) ? 0 : dotProduct / lenSq;

            const footX = axisLine.p1.x + t * vx;
            const footY = axisLine.p1.y + t * vy;

            // 步骤 B: 计算 P 关于垂足 F 的中心对称点 P' = 2F - P
            const reflectedX = 2 * footX - objToReflect.x;
            const reflectedY = 2 * footY - objToReflect.y;

            const reflectedPoint = new Point(name, reflectedX, reflectedY);
            this.state.objects.set(name, reflectedPoint);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, reflectedPoint, name);
            }

        } else {
            // 3. 如果两个参数都没有，则抛出错误
            throw new Error('ReflectedPoint requires either a "center" point or an "axis" line parameter.');
        }
    }

    private createRotatedPoint(params: Map<string, string>): void {
        // 1. 解析所有必需的参数
        const name = params.get('name') || params.get('n');
        const objName = params.get('obj') || params.get('o');
        const centerName = params.get('center') || params.get('c');
        const angleStr = params.get('angle') || params.get('a');

        if (!name || !objName || !centerName || !angleStr) {
            throw new Error('RotatedPoint requires a "name", "obj", "center", and "angle".');
        }

        // 2. 获取并验证几何对象
        const objToRotate = this.getObject(objName);
        if (!objToRotate || !(objToRotate instanceof Point)) {
            throw new Error(`Object to rotate must be a valid point: ${objName}`);
        }

        const centerPoint = this.getObject(centerName);
        if (!centerPoint || !(centerPoint instanceof Point)) {
            throw new Error(`Center of rotation must be a valid point: ${centerName}`);
        }

        const angleInDegrees = this.getNumberValue(params, 'angle') || this.getNumberValue(params, 'a');
        if (angleInDegrees == null || isNaN(angleInDegrees)) {
            throw new Error(`Invalid angle value: ${angleStr}`);
        }

        // --- 以下是核心计算逻辑 ---

        // 3. 将角度从度转换为弧度，因为Math.sin/cos使用弧度
        const angleInRadians = angleInDegrees * (Math.PI / 180);

        // 4. 为了方便计算，先将坐标系平移，使旋转中心作为原点
        const translatedX = objToRotate.x - centerPoint.x;
        const translatedY = objToRotate.y - centerPoint.y;

        // 5. 应用标准的2D旋转公式
        // x' = x*cos(θ) - y*sin(θ)
        // y' = x*sin(θ) + y*cos(θ)
        const rotatedX_temp = translatedX * Math.cos(angleInRadians) - translatedY * Math.sin(angleInRadians);
        const rotatedY_temp = translatedX * Math.sin(angleInRadians) + translatedY * Math.cos(angleInRadians);

        // 6. 将坐标系平移回去，得到最终坐标
        const finalX = rotatedX_temp + centerPoint.x;
        const finalY = rotatedY_temp + centerPoint.y;

        // 7. 创建并存储新的旋转点对象
        const rotatedPoint = new Point(name, finalX, finalY);
        this.state.objects.set(name, rotatedPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, rotatedPoint, name);
        }
    }

    private TwoLinesIntersection(params: Map<string, string>, obj1Raw: LinearObject, obj2Raw: LinearObject, name: string, obj1Name: string, obj2Name: string): void {
        const intersection = obj1Raw.IntersectionWithLine(obj2Raw);
        if (!intersection) {
            throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
        }

        // 这里需要创建实际的Point对象作为交点
        const intersectionPoint = new Point(name, intersection.x, intersection.y);
        this.state.objects.set(name, intersectionPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, intersectionPoint, name);
        }
    }

    private TwoCirclesIntersection(params: Map<string, string>, obj1Raw: Circle, obj2Raw: Circle, name: string, obj1Name: string, obj2Name: string): void {
        const intersectionPoints = obj1Raw.getPointAtDistanceFromTarget(obj2Raw.center, obj2Raw.radius);
        if (intersectionPoints.length === 0) {
            throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
        }

        const names = name.split(',');

        if (intersectionPoints.length == 1) {
            // 如果只有一个交点
            const intersectionPoint = new Point(names[0], intersectionPoints[0].x, intersectionPoints[0].y);
            this.state.objects.set(intersectionPoint.name, intersectionPoint);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, intersectionPoint, name);
            }

            return;
        }

        if (intersectionPoints.length == 2) {
            // 如果有两个交点
            // 从当前object里面查找Point，如果找到，那么一个点，那么就忽略第二个点的命名
            const findPoint0 = this.findPoint(intersectionPoints[0].x, intersectionPoints[0].y);
            const findPoint1 = this.findPoint(intersectionPoints[1].x, intersectionPoints[1].y);

            if (findPoint0 && findPoint1) {
                // 两个交点都已经命名了，不做处理
                return;
            }

            if (findPoint0) {
                const intersectionPoint = new Point(names[0], intersectionPoints[1].x, intersectionPoints[1].y);
                this.state.objects.set(intersectionPoint.name, intersectionPoint);

                const draw = params.get('draw');
                if (draw != null && draw == 'true' && this.state.ctx) {
                    this.drawObject(this.state.ctx, params, intersectionPoint, name);
                }

                return;
            }

            if (findPoint1) {
                const intersectionPoint = new Point(names[0], intersectionPoints[0].x, intersectionPoints[0].y);
                this.state.objects.set(intersectionPoint.name, intersectionPoint);

                const draw = params.get('draw');
                if (draw != null && draw == 'true' && this.state.ctx) {
                    this.drawObject(this.state.ctx, params, intersectionPoint, name);
                }

                return;
            }


            // 如果有两个交点
            const intersectionPoint1 = new Point(names[0], intersectionPoints[0].x, intersectionPoints[0].y);
            const intersectionPoint2 = new Point(names[1], intersectionPoints[1].x, intersectionPoints[1].y);
            this.state.objects.set(intersectionPoint1.name, intersectionPoint1);
            this.state.objects.set(intersectionPoint2.name, intersectionPoint2);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, intersectionPoint1, intersectionPoint1.name);
                this.drawObject(this.state.ctx, params, intersectionPoint2, intersectionPoint2.name);
            }

            return;
        }
    }

    private LineAndCircleIntersection(params: Map<string, string>, obj1Raw: LinearObject, obj2Raw: Circle, name: string, obj1Name: string, obj2Name: string): void {
        const points = obj2Raw.getIntersectionWithLine(obj1Raw);
        if (points.length === 0) {
            throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
        }

        const names = name.split(',');
        if (points.length === 1) {
            // 如果只有一个交点
            const intersectionPoint = new Point(names[0], points[0].x, points[0].y);
            this.state.objects.set(intersectionPoint.name, intersectionPoint);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, intersectionPoint, name);
            }

            return;
        }

        if (points.length === 2) {
            // 如果有两个交点
            // 从当前object里面查找Point，如果找到，那么一个点，那么就忽略第二个点的命名
            const findPoint0 = this.findPoint(points[0].x, points[0].y);
            const findPoint1 = this.findPoint(points[1].x, points[1].y);

            if (findPoint0 && findPoint1) {
                // 两个交点都已经命名了，不做处理
                return;
            }

            if (findPoint0) {
                const draw = params.get('draw');
                // 第一个点已经命名了，并且与当前点的命名相同，就不做操作，否则再创建一个点
                if (findPoint0.name != names[0]) {
                    const intersectionPoint = new Point(names[0], points[0].x, points[0].y);
                    this.state.objects.set(intersectionPoint.name, intersectionPoint);

                    if (draw != null && draw == 'true' && this.state.ctx) {
                        this.drawObject(this.state.ctx, params, intersectionPoint, names[0]);
                    }
                }

                const intersectionPoint = new Point(names[1], points[1].x, points[1].y);
                this.state.objects.set(intersectionPoint.name, intersectionPoint);


                if (draw != null && draw == 'true' && this.state.ctx) {
                    this.drawObject(this.state.ctx, params, intersectionPoint, name[1]);
                }

                return;
            }


            if (findPoint1) {
                const draw = params.get('draw');
                // 第二个点已经命名了，并且与当前点的命名相同，就不做操作，否则再创建一个点
                if (findPoint1.name != names[1]) {
                    const intersectionPoint = new Point(names[1], points[1].x, points[1].y);
                    this.state.objects.set(intersectionPoint.name, intersectionPoint);

                    if (draw != null && draw == 'true' && this.state.ctx) {
                        this.drawObject(this.state.ctx, params, intersectionPoint, names[1]);
                    }
                }

                const intersectionPoint = new Point(names[0], points[0].x, points[0].y);
                this.state.objects.set(intersectionPoint.name, intersectionPoint);


                if (draw != null && draw == 'true' && this.state.ctx) {
                    this.drawObject(this.state.ctx, params, intersectionPoint, name[0]);
                }
                return;
            }

            // 两个点都没有命名

            const intersectionPoint1 = new Point(names[0], points[0].x, points[0].y);
            const intersectionPoint2 = new Point(names[1], points[1].x, points[1].y);

            this.state.objects.set(intersectionPoint1.name, intersectionPoint1);
            this.state.objects.set(intersectionPoint2.name, intersectionPoint2);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, intersectionPoint1, intersectionPoint1.name);
                this.drawObject(this.state.ctx, params, intersectionPoint2, intersectionPoint2.name);
            }
        }
    }

    private createIntersection(params: Map<string, string>): void {
        // 实现两个对象交点创建
        const name = params.get('name');

        const obj1Name = params.get('obj1') || params.get('o1');
        const obj2Name = params.get('obj2') || params.get('o2');

        if (!name || !obj1Name || !obj2Name) {
            throw new Error('INTERSECT command requires name, obj1, and obj2 parameters');
        }

        const obj1Raw = this.getObject(obj1Name);
        const obj2Raw = this.getObject(obj2Name);

        if (!obj1Raw || !obj2Raw) {
            throw new Error(`Objects ${obj1Name} or ${obj2Name} not found`);
        }

        // 两条直线
        if (obj1Raw instanceof LinearObject && obj2Raw instanceof LinearObject) {
            // 如果两个对象都是线性对象，则计算交点
            return this.TwoLinesIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
        }

        // 两个圆
        if (obj1Raw instanceof Circle && obj2Raw instanceof Circle) {
            // 如果两个对象都是圆，则计算交点
            return this.TwoCirclesIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
        }

        // 一条直线和一个圆
        if (obj1Raw instanceof LinearObject && obj2Raw instanceof Circle) {
            // 如果一个对象是线性对象，另一个是圆，则计算交点
            return this.LineAndCircleIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
        }

        if (obj1Raw instanceof Circle && obj2Raw instanceof LinearObject) {
            // 如果一个对象是圆，另一个是线性对象，则计算交点
            return this.LineAndCircleIntersection(params, obj2Raw, obj1Raw, name, obj2Name, obj1Name);
        }

        // 一个角和一条直线
        if (obj1Raw instanceof Angle && obj2Raw instanceof LinearObject) {
            return this.TwoLinesIntersection(params, obj1Raw.line2!, obj2Raw, name, obj1Name, obj2Name); 
        }
        if (obj1Raw instanceof LinearObject && obj2Raw instanceof Angle) {
            return this.TwoLinesIntersection(params, obj1Raw, obj2Raw.line2!, name, obj1Name, obj2Name); 
        }

        // 一个角和一个圆
        if (obj1Raw instanceof Angle && obj2Raw instanceof Circle) {
            return this.LineAndCircleIntersection(params, obj1Raw.line2!, obj2Raw, name, obj1Name, obj2Name);
        }
        if (obj1Raw instanceof Circle && obj2Raw instanceof Angle) {
            return this.LineAndCircleIntersection(params, obj2Raw.line2!, obj1Raw, name, obj1Name, obj2Name);
        }

        // 两个角
        if (obj1Raw instanceof Angle && obj2Raw instanceof Angle) {
            return this.TwoLinesIntersection(params, obj1Raw.line2!, obj2Raw.line2!, name, obj1Name, obj2Name);
        }

    }

    private createAngleIntersection(params: Map<string, string>): void {

    }

    private createPointOnLine(params: Map<string, string>): void {
        // 实现线上点创建
        const name = params.get('name');
        const lineName = params.get('line');
        const distance = this.getNumberValue(params, 'distance') || this.getNumberValue(params, 'd') || 0;
        const pointName = params.get('point') || params.get('p');

        if (!name || !lineName || !pointName || isNaN(distance)) {
            throw new Error('POINT_ON_LINE command requires name, line, and point parameters');
        }

        const lineRaw = this.getObject(lineName);
        const pointRaw = this.getObject(pointName);

        if (!lineRaw || !pointRaw) {
            throw new Error(`Line ${lineName} or point ${pointName} not found`);
        }

        if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
            throw new Error(`Object ${lineName} is not a valid linear object`);
        }

        const line = lineRaw as LinearObject;
        const point = pointRaw as Point;

        // 计算点在线段上的位置
        const newPointPos = line.pointAtDistance(point, distance);
        const newPoint = new Point(name, newPointPos.x, newPointPos.y);
        this.state.objects.set(name, newPoint);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, newPoint, name);
        }
    }

    private createPerpBisector(params: Map<string, string>): void {
        // 实现垂直平分线创建
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');
        if (!name || !p1Name || !p2Name) {
            throw new Error('PERP_BISECTOR command requires name, p1, and p2 parameters');
        }

        const p1Raw = this.getObject(p1Name);
        const p2Raw = this.getObject(p2Name);

        if (!p1Raw || !p2Raw) {
            throw new Error(`Points ${p1Name} or ${p2Name} not found`);
        }

        const p1 = p1Raw as Point;
        const p2 = p2Raw as Point;

        // 计算中点
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const midpoint = new Point(name + '_<mid>', midX, midY);
        // 计算垂直平分线的斜率
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        let newPoint: Point;
        if (dx === 0) {
            newPoint = new Point(name + '_<dir>', midX + 1, midY); // 水平线            
        } else if (dy === 0) {
            newPoint = new Point(name + '_<dir>', midX, midY + 1); // 垂直线
        } else {
            let slope = -dx / dy; // 垂直斜率
            // 计算垂直平分线上的一个点
            newPoint = new Point(name + '_<dir>', midX + 1, midY + slope);
        }

        this.state.objects.set(midpoint.name, midpoint);
        this.state.objects.set(newPoint.name, newPoint);

        // 创建垂直平分线对象
        const perpBisector = new Line(name, midpoint, newPoint);
        this.state.objects.set(name, perpBisector);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, perpBisector, undefined);
        }
    }

    private createPerpendicular(params: Map<string, string>): void {
        // 实现垂线创建
        const name = params.get('name');
        const lineName = params.get('line');
        const pointName = params.get('point') || params.get('p');
        if (!name || !lineName || !pointName) {
            throw new Error('PERPENDICULAR command requires name, line, and point parameters');
        }
        const lineRaw = this.getObject(lineName);
        const pointRaw = this.getObject(pointName);
        if (!lineRaw || !pointRaw) {
            throw new Error(`Line ${lineName} or point ${pointName} not found`);
        }
        if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
            throw new Error(`Object ${lineName} is not a valid linear object`);
        }
        const line = lineRaw as LinearObject;
        const point = pointRaw as Point;

        // 计算垂线上的点
        const perpPointPos = line.perpendicularLineThroughPoint(point);
        const perpPoint = new Point(name + '_<pend>', perpPointPos.x, perpPointPos.y);

        this.state.objects.set(perpPoint.name, perpPoint);

        // 创建垂线
        const perpendicularLine = new Line(name, point, perpPoint);
        this.state.objects.set(name, perpendicularLine);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, perpendicularLine, undefined);
        }
    }

    private createParallel(params: Map<string, string>): void {
        // 实现平行线创建
        const name = params.get('name');
        const lineName = params.get('line');
        const pointName = params.get('point') || params.get('p');

        if (!name || !lineName || !pointName) {
            throw new Error('PARALLEL command requires name, line, and point parameters');
        }
        const lineRaw = this.getObject(lineName);
        const pointRaw = this.getObject(pointName);
        if (!lineRaw || !pointRaw) {
            throw new Error(`Line ${lineName} or point ${pointName} not found`);
        }
        if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
            throw new Error(`Object ${lineName} is not a valid linear object`);
        }

        const line = lineRaw as LinearObject;
        const point = pointRaw as Point;

        // 计算平行线上的点
        const parallelPointPos = line.parallelLineThroughPoint(point);
        const parallelPoint = new Point(name + '_<para>', parallelPointPos.x, parallelPointPos.y);
        this.state.objects.set(parallelPoint.name, parallelPoint);

        // 创建平行线
        const parallelLine = new Line(name, point, parallelPoint);
        this.state.objects.set(name, parallelLine);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, parallelLine, undefined);
        }

    }

    private createAngleBisector(params: Map<string, string>): void {
        // 实现角平分线创建
        const name = params.get('name');
        const angleName = params.get('angle') || params.get('a');

        if (!name || !angleName) {
            throw new Error('ANGLE_BISECTOR command requires name and angle parameters');
        }

        const angleRaw = this.getObject(angleName);
        if (!angleRaw || !(angleRaw instanceof Angle)) {
            throw new Error(`Angle ${angleName} not found or is not a valid angle object`);
        }

        const angle = angleRaw as Angle;
        // 计算角平分线上的点

        const bisectorPointPos = angle.getRotatedPoint1(angle.degreesValue / 2);
        const bisectorPoint = new Point(name + '_<bisector>', bisectorPointPos.x, bisectorPointPos.y);
        this.state.objects.set(bisectorPoint.name, bisectorPoint);

        // 创建角平分线
        const bisectorLine = new Line(name, angle.vertex, bisectorPoint);
        this.state.objects.set(name, bisectorLine);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, bisectorLine, undefined);
        }
    }

    private createCircumcircle(params: Map<string, string>): void {
        // 实现外接圆创建
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');
        const p3Name = params.get('p3');

        if (!name || !p1Name || !p2Name || !p3Name) {
            throw new Error('CIRCUMCIRCLE command requires name, p1, p2, and p3 parameters');
        }
        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);
        const p3 = this.getObject(p3Name);

        if (!p1 || !p2 || !p3) {
            throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
        }

        // 这里需要创建实际的Circumcircle对象
        const circumcircle = Circle.fromCircumcircle(p1 as Point, p2 as Point, p3 as Point);
        const center = new Point(name + '_<cumcenter>', circumcircle.pt.x, circumcircle.pt.y);
        this.state.objects.set(center.name, center);
        const circle = Circle.fromRadius(name, center, circumcircle.radius);
        this.state.objects.set(name, circle);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, circle, undefined);
        }
    }

    private createIncircle(params: Map<string, string>): void {
        // 实现内切圆创建
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');
        const p3Name = params.get('p3');

        if (!name || !p1Name || !p2Name || !p3Name) {
            throw new Error('CIRCUMCIRCLE command requires name, p1, p2, and p3 parameters');
        }
        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);
        const p3 = this.getObject(p3Name);

        if (!p1 || !p2 || !p3) {
            throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
        }

        // 这里需要创建实际的Incircle对象
        const incircle = Circle.fromIncircle(p1 as Point, p2 as Point, p3 as Point);
        const center = new Point(name + '_<inccenter>', incircle.pt.x, incircle.pt.y);
        this.state.objects.set(center.name, center);
        const circle = Circle.fromRadius(name, center, incircle.radius);
        this.state.objects.set(name, circle);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, circle, undefined);
        }
    }

    private createTangent(params: Map<string, string>): void {
        // 实现切线创建
        const name = params.get('name');
        const circleName = params.get('circle') || params.get('c');
        const pointName = params.get('point') || params.get('p');

        if (!name || !circleName || !pointName) {
            throw new Error('TANGENT command requires name, circle, and point parameters');
        }


        const circleRaw = this.getObject(circleName);
        const pointRaw = this.getObject(pointName);
        if (!circleRaw || !pointRaw) {
            throw new Error(`Circle ${circleName} or point ${pointName} not found`);
        }

        if (!(circleRaw instanceof Circle)) {
            throw new Error(`Object ${circleName} is not a valid circle object`);
        }

        const circle = circleRaw as Circle;
        const point = pointRaw as Point;

        const splitName = name.split(',');

        // 检查点是否在圆上
        const distance = circle.center.distanceTo(point);
        if (Math.abs(distance - circle.radius) <= this.zeroThresholdValue) {
            // 点在圆上
            // 创建切线, 只需要过P点作OP垂线即可
            const segmentRadius = new Segment(splitName[0] + '_<circle_radius>', point, circle.center);
            this.state.objects.set(segmentRadius.name, segmentRadius);

            const perpPointPos = segmentRadius.perpendicularLineThroughPoint(point);
            const perpPoint = new Point(splitName[0] + '_<circle_Point>', perpPointPos.x, perpPointPos.y);
            this.state.objects.set(perpPoint.name, perpPoint);

            const segment = new Segment(splitName[0], point, perpPoint);
            this.state.objects.set(name, segment);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, segment, undefined);
            }

        } else {
            if (distance < circle.radius) {
                // 点在圆内部，无法作切线
                throw new Error(`Point ${pointName} is inside the circle ${circleName}, cannot create tangent`);
            }
            // 点在圆外
            // 计算切线长度
            const tangentLength = Math.sqrt(distance * distance - circle.radius * circle.radius);

            // 获取P点到圆上距离等于tangentLength的点
            const tangentPointPos = circle.getPointAtDistanceFromTarget(point, tangentLength);
            if (tangentPointPos.length !== 2) {
                throw new Error(`Failed to calculate tangent point for ${pointName} on circle ${circleName}`);
            }

            const tangentPoint1 = new Point(splitName[0], tangentPointPos[0].x, tangentPointPos[0].y);
            const tangentPoint2 = new Point(splitName[1] || splitName[0] + '_<next_tangent_point>', tangentPointPos[1].x, tangentPointPos[1].y);

            this.state.objects.set(tangentPoint1.name, tangentPoint1);
            this.state.objects.set(tangentPoint2.name, tangentPoint2);

            const segment1 = new Segment(splitName[0], point, tangentPoint1);
            this.state.objects.set(segment1.name, segment1);
            const segment2 = new Segment(splitName[1], point, tangentPoint1);
            this.state.objects.set(segment2.name, segment2);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, segment1, undefined);
                this.drawObject(this.state.ctx, params, segment2, undefined);
            }
        }
    }

    private createPolygon(params: Map<string, string>): void {
        // 实现多边形创建
        const name = params.get('name');
        const pointsParam = params.get('points') || params.get('p');
        if (!name || !pointsParam) {
            throw new Error('POLYGON command requires name and points parameters');
        }

        const pointsNames = pointsParam.split(',');
        const points: Point[] = [];
        for (const pointName of pointsNames) {
            const point = this.getObject(pointName.trim());
            if (!point || !(point instanceof Point)) {
                throw new Error(`Point ${pointName} not found or is not a valid point object`);
            }
            points.push(point);
        }

        if (points.length < 3) {
            throw new Error('POLYGON command requires at least 3 points');
        }
        // 这里需要创建实际的Polygon对象
        const polygon = new Polygon(name, points);
        this.state.objects.set(name, polygon);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, polygon, undefined);
        }
    }

    private createTriangle(params: Map<string, string>): void {
        const name = params.get('name');
        const p1Name = params.get('p1');
        const p2Name = params.get('p2');
        const p3Name = params.get('p3');

        if (!name || !p1Name || !p2Name || !p3Name) {
            throw new Error('TRIANGLE command requires name, p1, p2, and p3 parameters');
        }

        const p1 = this.getObject(p1Name);
        const p2 = this.getObject(p2Name);
        const p3 = this.getObject(p3Name);

        if (!p1 || !p2 || !p3) {
            throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
        }

        // 这里需要创建实际的Triangle对象
        const triangle = new Triangle(name, p1 as Point, p2 as Point, p3 as Point);
        this.state.objects.set(name, triangle);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, triangle, undefined);
        }
    }

    private createRectangle(params: Map<string, string>): void {
        // 实现矩形创建
        const name = params.get('name');
        const p1Name = params.get('p1');
        const width = this.getNumberValue(params, 'width') || this.getNumberValue(params, 'w') || 0;
        const height = this.getNumberValue(params, 'height') || this.getNumberValue(params, 'h') || 0;

        if (!name || !p1Name || !width || !height) {
            throw new Error('RECTANGLE command requires name, p1, width, and height parameters');
        }

        const p1 = this.getObject(p1Name);
        if (!p1 || !(p1 instanceof Point)) {
            throw new Error(`Point ${p1Name} not found or is not a valid point object`);
        }

        // 这里需要创建实际的Rectangle对象
        const rectangle = Rectangle.fromWidthHeight(name, p1 as Point, width, height);
        this.state.objects.set(name, rectangle);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, rectangle, undefined);
        }
    }

    private createCircle(params: Map<string, string>): void {
        const name = params.get('name');

        if (!name) {
            throw new Error('CIRCLE command requires name parameters');
        }

        // 第一种创建方式，采用圆心和半径创建
        const centerName = params.get('center') || params.get('c');
        const radius = this.getNumberValue(params, 'radius') || this.getNumberValue(params, 'r') || 0;

        if (centerName && radius) {
            const center = this.getObject(centerName);
            if (!center || !(center instanceof Point)) {
                throw new Error(`Center point ${centerName} not found`);
            }

            // 这里需要创建实际的Circle对象
            const circle = Circle.fromRadius(name, center as Point, radius);
            this.state.objects.set(name, circle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, circle, undefined);
            }

            return;
        }

        // 第二种创建方式，采用圆心和一条线
        const chordName = params.get('chord');
        if (centerName && chordName) {
            const center = this.getObject(centerName);
            const chord = this.getObject(chordName);
            if (!chord || !(chord instanceof Segment) || !center || !(center instanceof Point)) {
                throw new Error(`chord is is invalid`);
            }

            const circle = Circle.fromChord(name, center, chord.p1, chord.p2);
            this.state.objects.set(name, circle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, circle, undefined);
            }

            return;
        }

        // 第三种方式，和第二种方式一样，只不过采用弦的两个端点
        const chordPt1Name = params.get('chordPt1');
        const chordPt2Name = params.get('chordPt2');

        if (centerName && chordPt1Name && chordPt2Name) {
            const center = this.getObject(centerName);
            const chordPt1 = this.getObject(chordPt1Name);
            const chordPt2 = this.getObject(chordPt2Name);

            if (!center || !(center instanceof Point) || !chordPt1 || !(chordPt1 instanceof Point) || !(chordPt2) || !(chordPt2 instanceof Point)) {
                throw new Error('create circle need center chordPt1 chordPt2');
            }

            const circle = Circle.fromChord(name, center, chordPt1, chordPt2);
            this.state.objects.set(name, circle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, circle, undefined);
            }

            return;
        }

        // 第四种方式，通过一条弦和一个圆心角（如果知道圆周角，只需乘以2），这里可以创建2个圆，因此需要提供两个name参数
        const centerAngleName = params.get('centerAngle');
        if (chordName && centerAngleName) {
            const chord = this.getObject(chordName);
            const centerAngle = this.getNumberValue(params, centerAngleName);

            if (!chord || !(chord instanceof LinearObject) || !centerAngle) {
                throw new Error('create circle need chord centerAngle paramters')
            }

            const names = name.split(',');
            if (names.length == 1) {
                names.push(name + '_<next_circle>');
            }

            this.createCircleByCenterAngleAndChord(params, names[0], names[1], chord.p1, chord.p2, centerAngle);

            return;
        }

        // 第五种方式，通过一条弦的两个端点和一个圆心角
        if (chordPt1Name && chordPt2Name && centerAngleName) {
            const chordPt1 = this.getObject(chordPt1Name);
            const chordPt2 = this.getObject(chordPt2Name);
            const centerAngle = this.getNumberValue(params, centerAngleName);

            if (!centerAngle || !chordPt1 || !(chordPt1 instanceof Point) || !(chordPt2) || !(chordPt2 instanceof Point)) {
                throw new Error('create circle need centerAngle chordPt1 chordPt2');
            }

            const names = name.split(',');
            if (names.length == 1) {
                names.push(name + '_<next_circle>');
            }

            this.createCircleByCenterAngleAndChord(params, names[0], names[1], chordPt1, chordPt2, centerAngle);

            return;
        }

        // console.log(`Created circle ${name} with center ${centerName} and radius ${radius}`);
    }

    private createCircleByCenterAngleAndChord(params: Map<string, string>, name_1: string, name_2: string, chordPt1: Point, chordPt2: Point, centerAngle: number): { c1: Circle, c2: Circle } {
        const midPoint = new PointNativeObject(
            (chordPt1.x + chordPt2.x) / 2,
            (chordPt1.y + chordPt2.y) / 2
        );

        const halfAngle = centerAngle / 2;

        const chordLength = chordPt1.distanceTo(chordPt2);

        if (GeometricObject.isZero(Math.cos(halfAngle))) {
            // 弦是直径
            const circleCenter = new Point(name_1 + '<_circle_center>', midPoint.x, midPoint.y);
            const circle = Circle.fromRadius(name_1, circleCenter, chordLength / 2);

            this.state.objects.set(circle.name, circle);

            return { c1: circle, c2: circle };
        }

        // 处理异常情况：圆心角为 0 或 2π 的倍数
        if (GeometricObject.isZero(Math.sin(halfAngle))) {
            throw new Error("Angle cannot be 0 or a multiple of 2π, as this would imply an infinite radius for a non-zero chord.");
        }

        // 2. 使用半角公式计算半径
        // 在由半径(斜边)、半弦长和圆心到弦的距离(h)构成的直角三角形中，
        // sin(halfAngle) = (chord.length / 2) / radius
        const halfChordLength = chordLength / 2;
        const radius = halfChordLength / Math.sin(halfAngle);

        // 3. 计算圆心到弦中点的距离 h
        // cos(halfAngle) = h / radius  =>  h = radius * cos(halfAngle)
        // 或者使用 tan: tan(halfAngle) = halfChordLength / h => h = halfChordLength / tan(halfAngle)
        const h = halfChordLength / Math.tan(halfAngle);

        // 4. 计算从弦的一个端点到另一个端点的向量
        const dx = chordPt2.x - chordPt1.x;
        const dy = chordPt2.y - chordPt1.y;

        // 5. 计算一个垂直于弦的向量。如果弦向量是 (dx, dy)，则垂直向量是 (-dy, dx)。
        // 这个垂直向量的长度恰好也等于弦长 `chord.length`。
        // 我们需要将其缩放，使其长度等于 h。
        // 缩放因子 = h / chord.length
        const scale = h / chordLength;
        const offsetX = -dy * scale;
        const offsetY = dx * scale;

        // 6. 计算两个可能的圆心
        // 从中点分别加上和减去这个偏移向量
        const center1 = new Point(
            name_1 + '_<circle_center>',
            midPoint.x + offsetX,
            midPoint.y + offsetY
        );
        const center2 = new Point(
            name_2 + '_<circle_center>',
            midPoint.x - offsetX,
            midPoint.y - offsetY
        );

        this.state.objects.set(center1.name, center1);
        this.state.objects.set(center2.name, center2);

        // 7. 创建两个圆并返回
        const c1 = Circle.fromRadius(name_1, center1, radius);
        const c2 = Circle.fromRadius(name_2, center2, radius);

        this.state.objects.set(c1.name, c1);
        this.state.objects.set(c2.name, c2);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, c1, undefined);
            this.drawObject(this.state.ctx, params, c2, undefined);
        }

        return { c1, c2 };
    }

    private createEllipse(params: Map<string, string>): void {
        // 实现椭圆创建
        const name = params.get('name');
        const centerName = params.get('center') || params.get('c');
        const radiusX = this.getNumberValue(params, 'radiusX') || this.getNumberValue(params, 'rX') || 0;
        const radiusY = this.getNumberValue(params, 'radiusY') || this.getNumberValue(params, 'rY') || 0;
        const rotation = this.getNumberValue(params, 'rotation') || this.getNumberValue(params, 'rot') || 0;
        if (!name || !centerName || !radiusX || !radiusY) {
            throw new Error('ELLIPSE command requires name and center, radiusX, radiusY parameters');
        }

        const center = this.getObject(centerName);
        if (!center) {
            throw new Error(`Center point ${centerName} not found`);
        }
        // 这里需要创建实际的Ellipse对象
        const ellipse = new Ellipse(name, center as Point, radiusX, radiusY, rotation);
        this.state.objects.set(name, ellipse);

        const draw = params.get('draw');
        if (draw != null && draw == 'true' && this.state.ctx) {
            this.drawObject(this.state.ctx, params, ellipse, undefined);
        }
    }

    private createParabola(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        if (!name) {
            throw new Error('Parabola command requires a "name" parameter.');
        }

        // --- 模式一：几何定义法 (vertex, pValue, rotateAngle) ---
        const vertexName = params.get('vertex') || params.get('v');
        const pValueStr = params.get('pValue') || params.get('p');
        const rotateAngleStr = params.get('rotateAngle') || params.get('rot') || '0';

        if (vertexName && pValueStr && rotateAngleStr) {
            const vertex = this.getObject(vertexName);
            if (!vertex || !(vertex instanceof Point)) {
                throw new Error(`Invalid vertex name for parabola: ${vertexName}`);
            }

            const pValue = this.getNumberValue(params, 'pValue') || this.getNumberValue(params, 'p');
            const rotateAngle = this.getNumberValue(params, 'rotateAngle') || this.getNumberValue(params, 'rot') || 0;

            if (pValue == null || isNaN(pValue) || rotateAngle == null || isNaN(rotateAngle)) {
                throw new Error('Invalid pValue or rotateAngle. They must be numbers.');
            }

            const parabola = new Parabola(name, vertex, pValue, rotateAngle);
            this.state.objects.set(name, parabola);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, parabola, undefined);
            }

            return;
        }

        // --- 模式二：函数系数法 (y = ax² + bx + c) ---
        const aStr = params.get('a');
        const bStr = params.get('b');
        const cStr = params.get('c');

        if (aStr !== undefined && bStr !== undefined && cStr !== undefined) {
            const a = this.getNumberValue(params, 'a');
            const b = this.getNumberValue(params, 'b');
            const c = this.getNumberValue(params, 'c');

            if (a == null || b == null || c == null || isNaN(a) || isNaN(b) || isNaN(c)) {
                throw new Error('Parameters a, b, c must be numbers.');
            }
            if (a === 0) {
                throw new Error('Parameter "a" cannot be zero for a parabola.');
            }

            // --- 从 y=ax²+bx+c 转换到 vertex, pValue, rotateAngle ---

            // 1. 计算顶点 (h, k)
            // h = -b / (2a)
            const h = -b / (2 * a);
            // k = a*h² + b*h + c
            const k = a * h * h + b * h + c;
            // 为这个计算出的顶点创建一个临时的Point对象
            const vertex = new Point(`${name}_vertex`, h, k);

            // 2. 计算 pValue
            // 标准形式 (x-h)² = 4f(y-k)，其中 f 是焦距。我们有 (x-h)² = (1/a)(y-k)。
            // 所以 4f = 1/a。在我们的 y²=2px 定义中，p=2f，所以对于垂直抛物线 x²=2py，p = 1/(2a)。
            // pValue 只表示开口大小，不关心方向，所以取绝对值。
            const pValue = Math.abs(1 / (2 * a));

            // 3. 计算旋转角度
            // 我们的标准模型 y²=2px 是向右开口的。
            // y = ax²... 中 a>0 (开口向上) 相当于标准模型逆时针旋转270度，即-90度。
            // a<0 (开口向下) 相当于标准模型逆时针旋转90度。
            const rotateAngle = (a > 0) ? -90 : 90;

            const parabola = new Parabola(name, vertex, pValue, rotateAngle);
            this.state.objects.set(name, parabola);
            // （可选）如果希望这个计算出的顶点也能被其他指令引用，可以也把它加入到对象列表

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, parabola, undefined);
            }

            return;
        }

        // --- 如果参数不匹配任何一种模式，则报错 ---
        throw new Error('To create a parabola, provide either {vertex, pValue, rotateAngle} or {a, b, c} parameters.');
    }

    private createHyperbola(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        if (!name) {
            throw new Error('Hyperbola command requires a "name" parameter.');
        }

        // --- 模式一：几何参数法 (center, aValue, bValue, rotateAngle) ---
        const centerName = params.get('center') || params.get('c');
        const aValueStr = params.get('aValue') || params.get('a');
        const bValueStr = params.get('bValue') || params.get('b');
        const rotateAngleStr = params.get('rotateAngle') || params.get('rot') || '0';

        if (centerName && aValueStr && bValueStr && rotateAngleStr) {
            const center = this.getObject(centerName);
            if (!center || !(center instanceof Point)) {
                throw new Error(`Invalid center name for hyperbola: ${centerName}`);
            }

            const aValue = this.getNumberValue(params, 'aValue') || this.getNumberValue(params, 'a');
            const bValue = this.getNumberValue(params, 'bValue') || this.getNumberValue(params, 'b');
            const rotateAngle = this.getNumberValue(params, 'rotateAngle') || this.getNumberValue(params, 'rot') || 0;

            if (aValue == null || bValue == null || rotateAngle == null ||
                isNaN(aValue) || isNaN(bValue) || isNaN(rotateAngle) || aValue <= 0 || bValue <= 0) {
                throw new Error('Invalid aValue, bValue or rotateAngle. They must be positive numbers.');
            }

            const hyperbola = new Hyperbola(name, center, aValue, bValue, rotateAngle);
            this.state.objects.set(name, hyperbola);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, hyperbola, undefined);
            }

            return;
        }

        // --- 模式二：焦点定义法 (f1, f2, diff) ---
        const f1Name = params.get('f1');
        const f2Name = params.get('f2');
        const diffStr = params.get('diff');

        if (f1Name && f2Name && diffStr) {
            const f1 = this.getObject(f1Name);
            const f2 = this.getObject(f2Name);
            if (!f1 || !(f1 instanceof Point) || !f2 || !(f2 instanceof Point)) {
                throw new Error(`Invalid foci names for hyperbola: ${f1Name}, ${f2Name}`);
            }

            const diff = this.getNumberValue(params, 'diff');
            if (diff == null || isNaN(diff) || diff <= 0) {
                throw new Error('Invalid "diff" value. It must be a positive number.');
            }

            // --- 从 f1, f2, diff 转换到 center, a, b, angle ---

            // 1. 计算中心点 (f1, f2 的中点)
            const centerX = (f1.x + f2.x) / 2;
            const centerY = (f1.y + f2.y) / 2;
            const center = new Point(`${name}_center`, centerX, centerY);

            // 2. 计算半实轴长 a (等于距离差的一半)
            const aValue = diff / 2;

            // 3. 计算焦距 c (等于中心到任一焦点的距离)
            const cValue = Math.sqrt(Math.pow(f1.x - centerX, 2) + Math.pow(f1.y - centerY, 2));

            // 4. 验证构造条件：对于双曲线，必须满足 c > a
            if (cValue <= aValue) {
                throw new Error(`Hyperbola construction failed: distance between foci (${2 * cValue}) must be greater than the constant difference (${diff}).`);
            }

            // 5. 计算半虚轴长 b (b² = c² - a²)
            const bValue = Math.sqrt(cValue * cValue - aValue * aValue);

            // 6. 计算旋转角度 (即焦点连线F1F2的角度)
            const angleRad = Math.atan2(f2.y - f1.y, f2.x - f1.x);
            const rotateAngle = angleRad * (180 / Math.PI);

            const hyperbola = new Hyperbola(name, center, aValue, bValue, rotateAngle);
            this.state.objects.set(name, hyperbola);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, hyperbola, undefined);
            }

            return;
        }

        // --- 如果参数不匹配任何一种模式，则报错 ---
        throw new Error('To create a hyperbola, provide either {center, aValue, bValue, rotateAngle} or {f1, f2, diff} parameters.');
    }


    private createAngle(params: Map<string, string>): void {
        // 实现角度创建
        const name = params.get('name');
        const vertexName = params.get('vertex') || params.get('v');
        const point1Name = params.get('p1');
        const point2Name = params.get('p2');
        const angleValue = this.getNumberValue(params, 'angle') || this.getNumberValue(params, 'a') || 0; // 角度值
        const showArc = GeometryDSLInterpreter.parseBoolean(params.get('showArc') || 'true');

        if (!name || !vertexName || !point1Name) {
            throw new Error('ANGLE command requires name, vertex, p1, and p2 parameters');
        }

        const vertex = this.getObject(vertexName);
        const point1 = this.getObject(point1Name);

        if (point2Name) {
            // 通过点2创建角度
            const point2 = this.getObject(point2Name);

            if (!vertex || !point1 || !point2) {
                throw new Error(`Points ${vertexName}, ${point1Name}, or ${point2Name} not found`);
            }

            // 这里需要创建实际的Angle对象
            const angle = new Angle(name, vertex as Point, point1 as Point, point2 as Point, showArc);
            this.state.objects.set(name, angle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, angle, undefined);
            }

        } else {
            // 通过一条边和角度值创建角度
            if (!vertex || !point1) {
                throw new Error(`Points ${vertexName} or ${point1Name} not found`);
            }

            const tempSegment = new Segment(name + '_<temp>', vertex as Point, point1 as Point);
            const point2Pos = tempSegment.rotateAroundPoint(angleValue * Math.PI / 180, vertex as Point, false);
            const point2 = new Point(name + '_<point2>', point2Pos.p2.x, point2Pos.p2.y);
            this.state.objects.set(point2.name, point2);

            // 这里需要创建实际的Angle对象
            const angle = new Angle(name, vertex as Point, point1 as Point, point2, showArc);
            this.state.objects.set(name, angle);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, angle, undefined);
            }
        }

        // console.log(`Created angle ${name} with vertex ${vertexName}, point1 ${point1Name}, and point2 ${point2Name}`);
    }

    private createFocis(params: Map<string, string>): void {
        // 实现焦点创建
        const name = params.get('name');
        const objectName = params.get('obj') || params.get('o');

        if (!name || !objectName) {
            throw new Error('FOCUS command requires name and point parameters');
        }

        const obj = this.getObject(objectName);
        if (!obj) {
            throw new Error(`Point ${objectName} not found`);
        }

        // 如果对象不是椭圆，双曲线，或抛物线，则抛出错误
        if (!(obj instanceof Ellipse)) {
            throw new Error(`Object ${objectName} is not a valid conic section for focus creation`);
        }

        if (obj instanceof Ellipse) {
            // 将name按逗号分割成两个
            const parts = name.split(',');
            if (parts.length !== 2) {
                throw new Error('FOCUS command requires name to be in format "focus1,focus2" for ellipse');
            }

            // 获取椭圆的焦点
            const objEllipse = obj as Ellipse;
            const points = objEllipse.getFoci();

            const pt1 = new Point(parts[0].trim(), points[0].x, points[0].y);
            const pt2 = new Point(parts[1].trim(), points[1].x, points[1].y);

            this.state.objects.set(pt1.name, pt1);
            this.state.objects.set(pt2.name, pt2);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, pt1, pt1.name);
                this.drawObject(this.state.ctx, params, pt2, pt2.name);
            }
        }
    }

    // 创建随机点
    private createRandomPoint(params: Map<string, string>): void {
        const name = params.get('name');
        const objName = params.get('obj') || params.get('o');

        if (!name || !objName) {
            throw new Error('RANDOMPOINT command requires name, obj parameter');
        }

        const start = params.get('start') || params.get('s');
        const end = params.get('end') || params.get('e');

        const obj = this.getObject(objName);
        if (!obj) {
            throw new Error(`Object ${objName} not found`);
        }

        if (obj instanceof LinearObject) {
            // 在直线上随机生成点
            const line = obj as LinearObject;
            const startPos = parseFloat(start || '0');
            const endPos = parseFloat(end || '1');
            const randomPoint = line.randomPointOnLine(startPos, endPos);
            const point = new Point(name, randomPoint.x, randomPoint.y);
            this.state.objects.set(name, point);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, point, name);
            }

            return;
        }

        if (obj instanceof Circle) {
            // 在圆内随机生成点
            const circle = obj as Circle;
            const startAngle = parseFloat(start || '0');
            const endAngle = parseFloat(end || '360');
            const randomPoint = circle.randomPointOnEdge(startAngle, endAngle);
            const point = new Point(name, randomPoint.x, randomPoint.y);
            this.state.objects.set(name, point);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, point, name);
            }

            return;
        }

        if (obj instanceof Ellipse) {
            // 在椭圆内随机生成点
            const ellipse = obj as Ellipse;
            const startAngle = parseFloat(start || '0');
            const endAngle = parseFloat(end || '360');
            const randomPoint = ellipse.randomPointOnEdge(startAngle, endAngle);
            const point = new Point(name, randomPoint.x, randomPoint.y);
            this.state.objects.set(name, point);

            const draw = params.get('draw');
            if (draw != null && draw == 'true' && this.state.ctx) {
                this.drawObject(this.state.ctx, params, point, name);
            }

            return;
        }
    }

    /* 创建插槽，插槽用于几何体属性的数值动态计算，语法为{slot}, 
    * 示例：
    * create slot name=slot_A value=10
    * create point name=A x={slot_A}, y={slot_A * 2}
    * 这样可以在几何体中使用插槽的值进行动态计算。
    * */
    private createSlot(params: Map<string, string>): void {
        const name = params.get('name');
        const valueString = params.get('value') || params.get('v') || params.get('expression') || params.get('e');

        if (!name || !valueString) {
            throw new Error('SLOT command requires name and expression parameters');
        }

        // Slot 类型，默认为数值（包括表达式），如果需要设置字符串类型的Slot，则需要设置为string
        const slotType = params.get('type') || params.get('t') || 'number';
        if (slotType.toLowerCase() === 'string') {
            this.state.slots.set(name, valueString);
        } else {
            const value = this.getNumberValue(params, 'value') || this.getNumberValue(params, 'v')
                || this.getNumberValue(params, 'expression') || this.getNumberValue(params, 'e') || 0;

            this.state.slots.set(name, value);
        }

    }

    /* 创建函数，插槽用于几何体属性的数值动态计算，语法为{func(x, y)}, 
    * args 为参数个数，在表达式中可以使用 args[1]代表第一个参数, args[2] 代表第二个参数
    * 示例：
    * create function name=vector_length args=2 value={sqrt(args[1] * args[1] + args[2] * args[2])}
    * create point name=A x=3, y=4
    * print m=(3, 4) length is {vector(3, 4)}
    * 这样可以在几何体中使用函数进行动态计算。
    * */
    private createFunction(params: Map<string, string>): void {
        const name = params.get('name') || params.get('n');
        const argsStr = params.get('args') || params.get('a');
        let value = params.get('value') || params.get('v') || params.get('expression') || params.get('e');

        if (!name || !argsStr || value === undefined) {
            throw new Error('FUNCTION command requires "name", "args", and "value" parameters.');
        }

        // 检查函数名是否与已存在的自定义函数冲突
        if (this.state.functions.has(name)) {
            throw new Error(`Function name "${name}" is already defined.`);
        }

        // (注意: 与内置函数的冲突检查将在 calculate 模块中进行)

        const argCount = parseInt(argsStr, 10);
        if (isNaN(argCount) || argCount < 0) {
            throw new Error(`Invalid number of arguments: ${argsStr}`);
        }

        // 移除表达式两边的花括号
        if (value.startsWith('{') && value.endsWith('}')) {
            value = value.slice(1, -1);
        }

        const customFunction: CustomFunction = {
            name,
            argCount,
            expression: value,
        };

        this.state.functions.set(name, customFunction);
        // this.state.onMessage?.('info', 0, `Created function ${name} with ${argCount} arguments.`);
    }

    /**
     * 创建曲线，需要传递一个Function对象。
     * 
     */
    private createCurve(params: Map<string, string>): void {

    }

    private createAnimation(params: Map<string, string>): void {
        const name = params.get('name');
        const interval = parseFloat(params.get('interval') || '1000'); // 默认1秒
        const repeat = GeometryDSLInterpreter.parseBoolean(params.get('repeat') || 'false');
        // 执行代码
        const code = params.get('code') || params.get('c');
        const slotName = params.get('slot') || params.get('s');

        if (!name || !code || !slotName) {
            throw new Error('ANIMATION command requires name, execute, update parameter');
        }

        // 如果已经存在这个动画，那么设置这个动画对象结束标记
        if (this.state.animations.has(name)) {
            const existingAnimation = this.state.animations.get(name);
            if (existingAnimation) {
                existingAnimation.isRunning = false;
                console.log(`Animation ${name} already exists, stopping it before creating a new one.`);
            }
        }

        if (!this.state.codes.has(code)) {
            throw new Error(`Animation ${name}: code ${code} not found`);
        }

        // 创建插槽
        this.state.slots.set(slotName, 0);

        // 创建动画对象
        const animation: AnimationState = {
            name: name,
            code: code,
            slot: slotName,
            isRepeat: repeat,
            currentFrame: 0,
            interval: interval,
            isRunning: true,
            animationTimer: 0
        };


        // 启动计时器执行动画，立即执行动画第一帧
        animation.animationTimer = setTimeout(() => {
            this.runAnimationCode(animation);
        }, 0);


        this.state.animations.set(name, animation);

        // console.log(`Created animation ${name} with code ${code} interval ${interval}ms and repeat ${repeat}`);
    }

    // 执行动画代码
    private runAnimationCode(animation: AnimationState): void {
        if (!this.state.ctx) return;

        const commands = this.state.codes.get(animation.code);
        if (!commands) {
            console.error(`Animation ${animation.name}: code ${animation.code} not found`);
            return;
        }

        // 执行代码片段
        this.executeLines(commands.map(x => x.rawCommand), false);

        // 如果动画已经终止了，不再继续执行
        if (animation.isRunning === false) {
            console.log(`Animation ${animation.name} is not running, stopping execution.`);
            return;
        }

        // 更新动画状态
        animation.currentFrame++;
        // 更新slot
        this.state.slots.set(animation.slot, animation.currentFrame);
        if (animation.isRepeat) {
            // 如果是循环动画，则重新开始
            animation.animationTimer = setTimeout(() => {
                this.runAnimationCode(animation);
            }, animation.interval);
        } else {
            // 如果不是循环动画，则停止
            animation.isRunning = false;
            console.log(`Animation ${animation.name} completed after ${animation.currentFrame} frames`);
        }
    }

    private parseColor(params: Map<string, string>, key: string): string | undefined;
    // private parseColor(colorString: string): string | undefined;
    private parseColor(args1: Map<string, string>, args2: string): string | undefined {
        const parseColorInternal = (colorString: string | undefined): string | undefined => {
            // 首先，处理 null, undefined 或空字符串的边缘情况，直接返回。
            if (!colorString) {
                return colorString;
            }

            // 定义一个正则表达式，用于严格匹配一个由6个十六进制字符组成的字符串。
            // ^ - 匹配字符串的开头
            // [0-9a-fA-F] - 匹配任何一个十六进制字符（数字0-9，字母a-f，不区分大小写）
            // {6} - 表示前面的模式必须精确匹配6次
            // $ - 匹配字符串的结尾
            const hexRegex = /^[0-9a-fA-F]{6}$/;

            // 使用正则表达式的 test() 方法来检查输入字符串是否匹配该模式。
            if (hexRegex.test(colorString)) {
                // 如果匹配成功，说明它是一个6位的十六进制颜色码。
                // 我们为其加上 '#' 前缀，并转换为大写以保持格式统一。
                return `#${colorString.toUpperCase()}`;
            } else {
                // 如果不匹配，我们假定它是一个颜色名（如 'red'）或一个已经格式化好的颜色值（如 '#FF00FF'）。
                // 在这种情况下，我们直接返回原始字符串，不做任何处理。
                return colorString;
            }
        }

        const params = args1 as Map<string, string>;
        const colorValue = params.get(args2);
        if (colorValue == null) {
            return undefined;
        }
        const reg = /\{([^}]+)\}/;
        if (reg.test(colorValue)) {
            const slotName = reg.exec(colorValue)![1].trim();
            const slotValue = this.state.slots.get(slotName);
            if (slotValue == null) {
                return undefined;
            }

            return parseColorInternal(slotValue.toString());
        } else {
            return parseColorInternal(colorValue);
        }
    }

    // 辅助方法
    private drawLabel(obj: GeometricObject, label: string, params: Map<string, string>, transform: { scale: number; offsetX: number; offsetY: number }): void {
        if (!this.state.ctx) return;

        // 默认标签位置为对象中心下方
        let direction = params.get('direction') || params.get('d') || 'down';
        if (direction === 'down' || direction === 'd') {
            direction = 'down'
        }

        if (direction === 'up' || direction === 'u') {
            direction = 'up';
        }

        if (direction === 'left' || direction === 'l') {
            direction = 'left';
        }

        if (direction === 'right' || direction === 'r') {
            direction = 'right';
        }

        if (direction !== 'down' && direction !== 'up' && direction !== 'left' && direction !== 'right') {
            throw new Error(`Invalid label direction: ${direction}. Use 'up', 'down', 'left', or 'right'.`);
        }

        // 绘制标签
        obj.drawLabel(this.state.ctx, transform, label, {
            drawDirection: direction,
            fontSize: parseFloat(params.get('fontSize') || params.get('fs') || '12'),
            color: this.parseColor(params, 'color') || this.parseColor(params, 'c') || this.state.defaultOptions.labelColor,
            backgroundColor: this.parseColor(params, 'backgroundColor') || this.parseColor(params, 'bgc') || 'transparent',
            padding: parseFloat(params.get('padding') || params.get('p') || '2'),
        });
    }

    // 公共方法，获取命名对象
    public getObject(name: string): GeometricObject | undefined {
        if (name == null || name === '') {
            return undefined;
        }

        const existNameObject = this.state.objects.get(name);
        if (existNameObject) {
            return existNameObject;
        }

        const existSlotValue = this.state.slots.get(name);
        if (existSlotValue !== undefined) {
            return this.state.objects.get(existSlotValue.toString());
        }

        const reg = /\{([^}]+)\}/;
        if (reg.test(name)) {
            const slotName = reg.exec(name)![1].trim();
            const slotValue = this.state.slots.get(slotName);
            if (slotValue === undefined) {
                return undefined;
            }

            return this.state.objects.get(slotValue.toString());
        }
    }

    // 查找一个点是否已经命名
    public findPoint(x: number, y: number): Point | undefined {
        for (let geoObjectKV of this.state.objects) {
            let geoObject = geoObjectKV[1];
            if (geoObject instanceof Point) {
                const distance = geoObject.distanceTo2(x, y);
                if (distance <= this.zeroThresholdValue) {
                    return geoObject;
                }
            }
        }

        return undefined;
    }

    public getAllObjects(): Map<string, GeometricObject> {
        return new Map(this.state.objects);
    }

    public setCanvas(canvas: HTMLCanvasElement): void {
        this.state.canvas = canvas;
        this.state.ctx = canvas.getContext('2d') || undefined;
    }
}