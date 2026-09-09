import { GeometricObject, type DrawOptions, type DrawLabelOptions, type IPoint } from './base';
import { Point, PointNativeObject } from './Point';

export class LinearNativeObject {
  constructor(p1: PointNativeObject, p2: PointNativeObject) {
    this.p1 = p1;
    this.p2 = p2;
  }

  public p1: PointNativeObject;
  public p2: PointNativeObject;
}

// 线性对象的抽象基类
export abstract class LinearObject extends GeometricObject {
  public p1: Point;
  public p2: Point;

  constructor(name: string, type: string, p1: Point, p2: Point) {
    super(name, type);
    this.p1 = p1;
    this.p2 = p2;
  }

  getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
    // 计算两个点的中点
    const midX = (this.p1.x + this.p2.x) / 2;
    const midY = (this.p1.y + this.p2.y) / 2;

    // 获取标签的实际尺寸（考虑padding）
    const padding = options.padding || 0;
    const actualTextWidth = textWidth + padding * 2;
    const actualTextHeight = textHeight + padding * 2;

    let labelX = midX;
    let labelY = midY;

    // 根据drawDirection确定标签位置
    if (options.drawDirection) {
      // 计算偏移距离，确保标签不与直线重叠
      const offsetDistance = Math.max(actualTextHeight, actualTextWidth) / 2 / transform.scale + 5 / transform.scale;

      switch (options.drawDirection) {
        case 'down':
          labelY += offsetDistance;
          break;
        case 'up':
          labelY -= offsetDistance;
          break;
        case 'left':
          labelX -= offsetDistance;
          break;
        case 'right':
          labelX += offsetDistance;
          break;
      }
    } else {
      // 如果没有指定方向，智能选择标签位置
      // 计算直线的方向向量
      const dx = this.p2.x - this.p1.x;
      const dy = this.p2.y - this.p1.y;

      // 计算直线的角度
      const lineAngle = Math.atan2(dy, dx);

      // 计算垂直于直线的方向（向上偏移）
      const perpAngle = lineAngle + Math.PI / 2;

      // 计算偏移距离
      const offsetDistance = Math.max(actualTextHeight, actualTextWidth) / 2 / transform.scale + 8 / transform.scale;

      // 选择垂直方向上的偏移，通常选择向上的方向
      // 如果直线接近垂直，则选择向右偏移
      if (Math.abs(Math.cos(lineAngle)) < 0.3) {
        // 直线接近垂直，向右偏移
        labelX += offsetDistance;
      } else {
        // 直线不是很垂直，使用垂直方向偏移
        labelX += Math.cos(perpAngle) * offsetDistance;
        labelY += Math.sin(perpAngle) * offsetDistance;

        // 确保标签偏移到直线的"上方"（屏幕坐标系中y值较小的方向）
        if (Math.sin(perpAngle) > 0) {
          labelX += Math.cos(perpAngle + Math.PI) * offsetDistance;
          labelY += Math.sin(perpAngle + Math.PI) * offsetDistance;
        }
      }
    }

    // 应用变换
    return {
      x: labelX * transform.scale + transform.offsetX,
      y: labelY * transform.scale + transform.offsetY
    };
  }

  // 直线绕着 p1 点旋转指定角度
  /**
   * 
   * @param angle 旋转角度，单位为弧度
   * @param centerPoint 旋转的中心点
   * @param direction true为顺时针旋转，false为逆时针旋转
   */
  public rotateAroundPoint(angle: number, centerPoint: Point, direction: boolean): LinearNativeObject {
    // 1. 调用 p1 点自身的旋转方法，得到旋转后的新点 newP1
    const newP1 = this.p1.rotateSinglePoint(centerPoint, angle, direction);

    // 2. 调用 p2 点自身的旋转方法，得到旋转后的新点 newP2
    const newP2 = this.p2.rotateSinglePoint(centerPoint, angle, direction);

    // 3. 将两个新的点对象组合成一个 LinearNativeObject 并返回
    return {
      p1: newP1,
      p2: newP2
    };
  }

  /**
   * @param point 检查点是否在直线、线段或射线上
   */
  public containsPoint(point: Point): boolean {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      // p1 和 p2 是同一点
      return point.x === this.p1.x && point.y === this.p1.y;
    }

    // 检查点是否共线
    const crossProduct = (point.y - this.p1.y) * dx - (point.x - this.p1.x) * dy;
    if (Math.abs(crossProduct) > 1e-6) { // 使用一个小的容差
      return false; // 不共线
    }

    // 检查点是否在线段的x和y范围内
    const dotProduct = (point.x - this.p1.x) * dx + (point.y - this.p1.y) * dy;
    return dotProduct >= 0 && dotProduct <= lengthSquared;
  }

  // 在线段上取一个给定长度的点
  public pointAtDistance(startPoint: Point, distance: number): PointNativeObject {
    let dx: number;
    let dy: number;

    // 1. 根据规则确定方向向量 (dx, dy)
    // 检查起始点是否为 p2，以决定方向
    if (startPoint.name === this.p2.name) {
      // 方向为 p2 -> p1
      dx = this.p1.x - this.p2.x;
      dy = this.p1.y - this.p2.y;
    } else {
      // 默认方向为 p1 -> p2 (适用于 startPoint 是 p1 或任何其他点的情况)
      dx = this.p2.x - this.p1.x;
      dy = this.p2.y - this.p1.y;
    }

    // 2. 计算方向向量的长度（即 p1 和 p2 之间的距离）
    const length = Math.sqrt(dx * dx + dy * dy);

    // 3. 处理特殊情况：线段长度为零
    // 当 p1 和 p2 是同一个点时，无法定义方向。
    if (length === 0) {
      // 如果移动距离也为0，可以认为结果就是起点本身。
      if (distance === 0) {
        return new PointNativeObject(startPoint.x, startPoint.y);
      }
      // 否则，无法在无方向的线上移动，抛出错误。
      throw new Error("Cannot calculate point on a zero-length segment (p1 and p2 are the same).");
    }

    // 4. 计算缩放比例
    // 这是为了将方向向量转换为单位向量后再乘以目标距离，一步完成。
    const scale = distance / length;

    // 5. 计算新点的坐标
    // 新坐标 = 起点坐标 + 方向向量 * 缩放比例
    const newX = startPoint.x + dx * scale;
    const newY = startPoint.y + dy * scale;

    // 6. 创建并返回新的 Point 对象
    return new PointNativeObject(newX, newY);
  }

  // 取得该直线的方向向量
  public get directionVector(): PointNativeObject {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;

    if (dx === 0 && dy === 0) {
      throw new Error("Cannot calculate slope for a point.");
    }

    if (dx === 0) {
      return new PointNativeObject(0, dy > 0 ? 1 : -1); // 垂直线
    }
    if (dy === 0) {
      return new PointNativeObject(dx > 0 ? 1 : -1, 0); // 水平线
    }
    return new PointNativeObject(dx > 0 ? 1 : -1, dy / dx); // 一般情况
  }

  // 获取某点的垂线上的一个点
  public perpendicularLineThroughPoint(point: Point): PointNativeObject {
    // 首先，计算该线性对象的方向向量
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;

    // 如果p1和p2是同一个点，则它不是一条线，无法定义垂线
    if (dx === 0 && dy === 0) {
      throw new Error("Cannot calculate a perpendicular line for a single point object.");
    }

    // 原直线的方向向量是 (dx, dy)。
    // 与其垂直的向量是 (-dy, dx)。这是一个关键的几何原理。
    // 例如，如果原直线是水平的 (dx=1, dy=0)，则垂线向量是 (0, 1)，即垂直向上。
    // 如果原直线是垂直的 (dx=0, dy=1)，则垂线向量是 (-1, 0)，即水平向左。

    // 我们需要找到一条经过输入点 `point` 且方向为 (-dy, dx) 的直线。
    // 获取这条垂线上的任意一个点，最简单的方法就是从 `point` 开始，
    // 沿着垂直向量移动。
    // 新点的坐标 = point的坐标 + 垂直向量的分量
    const perpendicularPointX = point.x - dy;
    const perpendicularPointY = point.y + dx;

    // 返回这个新计算出的点
    return new PointNativeObject(perpendicularPointX, perpendicularPointY);
  }

  /**
 * 计算并返回一个点，该点位于一条穿过指定点且与当前线段平行的线上。
 *
 * @param throughPoint 平行线必须穿过的点。
 * @param name 新点的名称。
 * @param distance (可选) 从 a_PointAlongLine 沿着平行线方向移动的距离。
 * 如果为正，则沿 p1->p2 方向移动；如果为负，则反向移动。
 * 如果未提供，默认使用当前线段自身的长度。
 * @returns {Point} 一个在平行线上的新点。
 */
  public parallelLineThroughPoint(throughPoint: Point, distance?: number): PointNativeObject {
    // 1. 获取原始线段的方向向量 (p1 -> p2)
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;

    // 2. 计算方向向量的长度
    const length = Math.sqrt(dx * dx + dy * dy);

    // 3. 处理原始线段长度为零的特殊情况
    if (length === 0) {
      throw new Error("Cannot define a parallel line for a zero-length segment (p1 and p2 are the same).");
    }

    // 4. 确定要移动的距离
    // 如果用户没有提供 distance 参数，我们就使用原始线段的长度作为默认值。
    const moveDistance = distance ?? length;

    // 5. 计算缩放比例
    const scale = moveDistance / length;

    // 6. 计算新点的坐标
    // 新坐标 = 起点(throughPoint)坐标 + 方向向量 * 缩放比例
    const newX = throughPoint.x + dx * scale;
    const newY = throughPoint.y + dy * scale;

    // 7. 返回新创建的点
    return new PointNativeObject(newX, newY);
  }

  public randomPointOnLine(start: number, end: number): PointNativeObject {
    // 生成一个介于-5和5之间的随机数
    const t = Math.random() * (end - start) + start; // 这样可以生成一个范围在[-5, 5]之间的随机数

    // 计算随机点的坐标
    const x = this.p1.x + t * (this.p2.x - this.p1.x);
    const y = this.p1.y + t * (this.p2.y - this.p1.y);

    return new PointNativeObject(x, y);
  }

  public IntersectionWithLine(other: LinearObject): PointNativeObject | null {
    const x1 = this.p1.x;
    const y1 = this.p1.y;
    const x2 = this.p2.x;
    const y2 = this.p2.y;

    const x3 = other.p1.x;
    const y3 = other.p1.y;
    const x4 = other.p2.x;
    const y4 = other.p2.y;

    // 计算分母 D
    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

    // 如果分母为0，则两直线平行或共线
    // 使用一个小的容差值来处理浮点数精度问题
    if (Math.abs(denominator) < 1e-9) {
      return null;
    }

    // 计算参数 t 的分子
    const tNumerator = (x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4);

    // 计算参数 t
    const t = tNumerator / denominator;

    // 使用参数 t 计算交点的坐标
    const intersectX = x1 + t * (x2 - x1);
    const intersectY = y1 + t * (y2 - y1);

    // 创建并返回交点对象
    return new PointNativeObject(intersectX, intersectY);
  }
}

// 无限长的直线
export class Line extends LinearObject {
  constructor(name: string, p1: Point, p2: Point) {
    super(name, 'line', p1, p2);
  }

  public draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void {
    ctx.save();
    ctx.beginPath();

    const { scale, offsetX, offsetY } = transform;

    // Apply options
    ctx.strokeStyle = options?.color || 'black';
    ctx.lineWidth = options?.lineWidth || 1;
    if (options?.dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }

    // Transform points
    const transformedP1 = this.p1.transform(scale, offsetX, offsetY);
    const transformedP2 = this.p2.transform(scale, offsetX, offsetY);

    // Calculate direction vector
    const dx = transformedP2.x - transformedP1.x;
    const dy = transformedP2.y - transformedP1.y;

    // Handle vertical line case
    if (Math.abs(dx) < 1e-6) { // Effectively vertical
      ctx.moveTo(transformedP1.x, 0);
      ctx.lineTo(transformedP1.x, ctx.canvas.height);
    } else {
      // Calculate points far outside the canvas
      const slope = dy / dx;
      const intercept = transformedP1.y - slope * transformedP1.x;

      // Points at canvas edges
      const x1 = 0;
      const y1 = slope * x1 + intercept;
      const x2 = ctx.canvas.width;
      const y2 = slope * x2 + intercept;

      const y3 = 0;
      const x3 = (y3 - intercept) / slope;
      const y4 = ctx.canvas.height;
      const x4 = (y4 - intercept) / slope;

      const points = [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
        { x: x3, y: y3 },
        { x: x4, y: y4 }
      ].filter(p => p.x >= -10000 && p.x <= ctx.canvas.width + 10000 && p.y >= -10000 && p.y <= ctx.canvas.height + 10000); // Filter out extreme points

      // Sort points by x-coordinate to ensure correct drawing order
      points.sort((a, b) => a.x - b.x);

      if (points.length >= 2) {
        ctx.moveTo(points[0].x, 0 - points[0].y);
        ctx.lineTo(points[points.length - 1].x, 0 - points[points.length - 1].y);
      } else {
        // Fallback for very short lines or lines that don't cross canvas edges
        // Extend a fixed large distance
        const length = 10000; // A large arbitrary length
        const angle = Math.atan2(dy, dx);
        const extP1X = transformedP1.x - length * Math.cos(angle);
        const extP1Y = transformedP1.y - length * Math.sin(angle);
        const extP2X = transformedP1.x + length * Math.cos(angle);
        const extP2Y = transformedP1.y + length * Math.sin(angle);

        ctx.moveTo(extP1X, 0 - extP1Y);
        ctx.lineTo(extP2X, 0 - extP2Y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }
}

// 线段
export class Segment extends LinearObject {
  constructor(name: string, p1: Point, p2: Point) {
    super(name, 'segment', p1, p2);
  }

  // 使用getter计算长度
  get length(): number {
    return this.p1.distanceTo(this.p2);
  }

  public draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void {
    ctx.save();
    ctx.beginPath();

    const { scale, offsetX, offsetY } = transform;

    // Apply options
    ctx.strokeStyle = options?.color || 'black';
    ctx.lineWidth = options?.lineWidth || 1;
    if (options?.dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }

    // Transform points
    const transformedP1 = this.p1.transform(scale, offsetX, offsetY);
    const transformedP2 = this.p2.transform(scale, offsetX, offsetY);

    ctx.moveTo(transformedP1.x, 0 - transformedP1.y);
    ctx.lineTo(transformedP2.x, 0 - transformedP2.y);

    ctx.stroke();
    ctx.restore();
  }
}

// 射线
export class Ray extends LinearObject {
  // 注意，对于射线，p1是起点，p2是方向点
  constructor(name: string, start: Point, through: Point) {
    super(name, 'ray', start, through);
  }

  get startPoint(): Point {
    return this.p1;
  }

  get directionPoint(): Point {
    return this.p2;
  }

  // 在射线上取一个给定长度的点
  public pointAtDistance(startPoint: Point, distance: number): PointNativeObject {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      throw new Error("Direction vector cannot be zero.");
    }
    const scale = distance / length;
    return new PointNativeObject(startPoint.x + dx * scale, startPoint.y + dy * scale);
  }

  public draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void {
    ctx.save();
    ctx.beginPath();

    const { scale, offsetX, offsetY } = transform;

    // Apply options
    ctx.strokeStyle = options?.color || 'black';
    ctx.lineWidth = options?.lineWidth || 1;
    if (options?.dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }

    // Transform points
    const transformedStart = this.p1.transform(scale, offsetX, offsetY);
    const transformedThrough = this.p2.transform(scale, offsetX, offsetY);

    // Calculate direction vector
    const dx = transformedThrough.x - transformedStart.x;
    const dy = transformedThrough.y - transformedStart.y;

    // Extend the ray far beyond the canvas
    const length = 10000; // A large arbitrary length
    const angle = Math.atan2(dy, dx);

    const endX = transformedStart.x + length * Math.cos(angle);
    const endY = transformedStart.y + length * Math.sin(angle);

    ctx.moveTo(transformedStart.x, 0 - transformedStart.y);
    ctx.lineTo(endX, 0 - endY);

    ctx.stroke();
    ctx.restore();
  }
}
