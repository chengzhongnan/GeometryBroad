// AiGeometryBroad/scripts/render-screenshot-problem.ts
import { readFileSync, writeFileSync } from "node:fs";

// AiGeometryBroad/src/core/geometry/base.ts
function toScreenPoint(x, y, transform) {
  return {
    x: x * transform.scale + transform.offsetX,
    y: transform.offsetY - y * transform.scale
  };
}
var GeometricObject = class {
  name;
  type;
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
  // 绘制几何对象标签
  drawLabel(ctx, transform, label, options) {
    ctx.save();
    ctx.font = `${options?.fontStyle || "normal"} ${options?.fontWeight || "normal"} ${options?.fontSize || 12}px ${options?.fontFamily || "Arial"}`;
    ctx.fillStyle = options?.color || "black";
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const parsedFontHeight = parseInt(ctx.font, 10);
    const textHeight = Number.isFinite(parsedFontHeight) && parsedFontHeight > 0 ? parsedFontHeight : options?.fontSize || 12;
    const labelPosition = this.getDrawLabelPosition(transform, options, textWidth, textHeight);
    const backgroundColor = options?.backgroundColor;
    if (backgroundColor && backgroundColor !== "transparent" && backgroundColor !== "none") {
      const padding = options.padding || 0;
      const bgWidth = textWidth + padding * 2;
      const bgHeight = textHeight + padding * 2;
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(
        labelPosition.x - padding,
        labelPosition.y - textHeight - padding,
        bgWidth,
        bgHeight
      );
      ctx.fillStyle = options.color || "black";
    }
    ctx.fillText(label, labelPosition.x, labelPosition.y);
    ctx.restore();
  }
  static isZero(data) {
    return Math.abs(data) <= 1e-9;
  }
};

// AiGeometryBroad/src/core/geometry/Point.ts
var PointNativeObject = class {
  x;
  y;
  radius;
  // 半径
  real;
  // 是否为实心点，false表示空心点
  constructor(x, y, radius = 1, real = true) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.real = real;
  }
};
var Point = class extends GeometricObject {
  x;
  y;
  radius;
  // 默认半径
  real;
  // 是否为实心点，false表示空心点
  constructor(name, x, y, radius = 1, real = true) {
    super(name, "point");
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.real = real;
  }
  /**
   * 点的旋转
   * @param rotateCenter 旋转中心点
   * @param angle 旋转角度（弧度）
   * @param direction true表示顺时针旋转，false表示逆时针旋转
   */
  rotateSinglePoint(rotateCenter, angle, direction) {
    const effectiveAngle = direction ? -angle : angle;
    const cosAngle = Math.cos(effectiveAngle);
    const sinAngle = Math.sin(effectiveAngle);
    const translatedX = this.x - rotateCenter.x;
    const translatedY = this.y - rotateCenter.y;
    const rotatedX = translatedX * cosAngle - translatedY * sinAngle;
    const rotatedY = translatedX * sinAngle + translatedY * cosAngle;
    const finalX = rotatedX + rotateCenter.x;
    const finalY = rotatedY + rotateCenter.y;
    return new PointNativeObject(finalX, finalY, this.radius, this.real);
  }
  // 计算两点之间的距离
  distanceTo(other) {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  distanceTo2(x, y) {
    const dx = this.x - x;
    const dy = this.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  // 应用变换，返回一个新的Point对象
  transform(scale, offsetX, offsetY) {
    const transformedX = this.x * scale + offsetX;
    const transformedY = this.y * scale - offsetY;
    const newPoint = new PointNativeObject(transformedX, transformedY);
    newPoint.radius = this.radius;
    newPoint.real = this.real;
    return newPoint;
  }
  // 绘制点
  draw(ctx, transform, options) {
    const canvasPt = this.transform(transform.scale, transform.offsetX, transform.offsetY);
    ctx.beginPath();
    ctx.arc(canvasPt.x, 0 - canvasPt.y, this.radius * transform.scale * (options?.highlight ? 2 : 1), 0, Math.PI * 2);
    ctx.closePath();
    if (this.real) {
      ctx.fillStyle = options?.fillColor || "black";
      ctx.fill();
    } else {
      ctx.strokeStyle = options?.color || "black";
      ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
      ctx.stroke();
    }
  }
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const padding = options.padding || 0;
    const actualTextWidth = textWidth + padding * 2;
    const actualTextHeight = textHeight + padding * 2;
    let labelX = this.x;
    let labelY = this.y;
    const actualRadius = this.radius * transform.scale;
    if (options.drawDirection) {
      const offsetDistance = Math.max(
        actualRadius / transform.scale + actualTextHeight / 2 / transform.scale,
        actualRadius / transform.scale + actualTextWidth / 2 / transform.scale
      ) + 1 / transform.scale;
      switch (options.drawDirection) {
        case "down":
          labelY -= offsetDistance;
          break;
        case "up":
          labelY += offsetDistance;
          break;
        case "left":
          labelX -= offsetDistance;
          break;
        case "right":
          labelX += offsetDistance;
          break;
      }
    } else {
      const defaultAngle = Math.PI / 4;
      const offsetDistance = Math.max(
        actualRadius / transform.scale + Math.max(actualTextWidth, actualTextHeight) / 2 / transform.scale,
        9 / transform.scale
        // 最小偏移距离
      ) + 1 / transform.scale;
      labelX += Math.cos(defaultAngle) * offsetDistance;
      labelY += Math.sin(defaultAngle) * offsetDistance;
    }
    return toScreenPoint(labelX, labelY, transform);
  }
};

// AiGeometryBroad/src/core/geometry/LinearObject.ts
function clipToRect(anchorX, anchorY, ux, uy, rect, tMin) {
  let lower = tMin;
  let upper = Infinity;
  if (Math.abs(ux) < 1e-12) {
    if (anchorX < rect.x || anchorX > rect.x + rect.width) return null;
  } else {
    let t1 = (rect.x - anchorX) / ux;
    let t2 = (rect.x + rect.width - anchorX) / ux;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    lower = Math.max(lower, t1);
    upper = Math.min(upper, t2);
  }
  if (Math.abs(uy) < 1e-12) {
    if (anchorY < rect.y || anchorY > rect.y + rect.height) return null;
  } else {
    let t1 = (rect.y - anchorY) / uy;
    let t2 = (rect.y + rect.height - anchorY) / uy;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    lower = Math.max(lower, t1);
    upper = Math.min(upper, t2);
  }
  if (!(upper > lower)) return null;
  return [lower, upper];
}
var LinearNativeObject = class {
  constructor(p1, p2) {
    this.p1 = p1;
    this.p2 = p2;
  }
  p1;
  p2;
};
var LinearObject = class extends GeometricObject {
  p1;
  p2;
  constructor(name, type, p1, p2) {
    super(name, type);
    this.p1 = p1;
    this.p2 = p2;
  }
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const midX = (this.p1.x + this.p2.x) / 2;
    const midY = (this.p1.y + this.p2.y) / 2;
    const padding = options.padding || 0;
    const actualTextWidth = textWidth + padding * 2;
    const actualTextHeight = textHeight + padding * 2;
    let labelX = midX;
    let labelY = midY;
    if (options.drawDirection) {
      const offsetDistance = Math.max(actualTextHeight, actualTextWidth) / 2 / transform.scale + 5 / transform.scale;
      switch (options.drawDirection) {
        case "down":
          labelY += offsetDistance;
          break;
        case "up":
          labelY -= offsetDistance;
          break;
        case "left":
          labelX -= offsetDistance;
          break;
        case "right":
          labelX += offsetDistance;
          break;
      }
    } else {
      const dx = this.p2.x - this.p1.x;
      const dy = this.p2.y - this.p1.y;
      const lineAngle = Math.atan2(dy, dx);
      const perpAngle = lineAngle + Math.PI / 2;
      const offsetDistance = Math.max(actualTextHeight, actualTextWidth) / 2 / transform.scale + 8 / transform.scale;
      if (Math.abs(Math.cos(lineAngle)) < 0.3) {
        labelX += offsetDistance;
      } else {
        labelX += Math.cos(perpAngle) * offsetDistance;
        labelY += Math.sin(perpAngle) * offsetDistance;
        if (Math.sin(perpAngle) > 0) {
          labelX += Math.cos(perpAngle + Math.PI) * offsetDistance;
          labelY += Math.sin(perpAngle + Math.PI) * offsetDistance;
        }
      }
    }
    return toScreenPoint(labelX, labelY, transform);
  }
  // 统一的描边样式设置
  applyStrokeStyle(ctx, options) {
    ctx.strokeStyle = options?.color || "black";
    ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
    if (options?.dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }
  }
  /**
   * 计算线性对象本次实际要绘制的区间。
   *
   * 返回值是沿单位方向 (ux, uy)、以锚点 (anchorX, anchorY) 为原点的参数区间 [t0, t1]，
   * 单位为屏幕像素；返回 null 表示该对象在可视区域内没有可见部分。
   *
   * - 指定了 length（逻辑单位）：forwardOnly 为 false 时以锚点为中心向两端各延伸一半（直线），
   *   为 true 时从锚点向前延伸（射线）。
   * - 未指定 length：只延伸到可视区域的边缘就停住，不再往外，
   *   避免无限长的线把导出 SVG 的画布撑得非常大、几何图形显得很小。
   */
  resolveDrawExtent(ctx, transform, options, anchorX, anchorY, ux, uy, tMin, forwardOnly) {
    const specified = options?.length;
    const total = typeof specified === "number" && Number.isFinite(specified) ? specified * Math.abs(transform.scale) : 0;
    if (total > 0) {
      if (forwardOnly) {
        return [tMin, tMin + total];
      }
      const half = total / 2;
      return [-half, half];
    }
    const rect = options?.visibleRect;
    const visible = rect && rect.width > 0 && rect.height > 0 ? rect : { x: 0, y: 0, width: ctx.canvas.width, height: ctx.canvas.height };
    return clipToRect(anchorX, anchorY, ux, uy, visible, tMin);
  }
  // 直线绕着 p1 点旋转指定角度
  /**
   * 
   * @param angle 旋转角度，单位为弧度
   * @param centerPoint 旋转的中心点
   * @param direction true为顺时针旋转，false为逆时针旋转
   */
  rotateAroundPoint(angle, centerPoint, direction) {
    const newP1 = this.p1.rotateSinglePoint(centerPoint, angle, direction);
    const newP2 = this.p2.rotateSinglePoint(centerPoint, angle, direction);
    return {
      p1: newP1,
      p2: newP2
    };
  }
  /**
   * @param point 检查点是否在直线、线段或射线上
   */
  containsPoint(point) {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
      return point.x === this.p1.x && point.y === this.p1.y;
    }
    const crossProduct = (point.y - this.p1.y) * dx - (point.x - this.p1.x) * dy;
    if (Math.abs(crossProduct) > 1e-6) {
      return false;
    }
    const dotProduct = (point.x - this.p1.x) * dx + (point.y - this.p1.y) * dy;
    return dotProduct >= 0 && dotProduct <= lengthSquared;
  }
  // 在线段上取一个给定长度的点
  pointAtDistance(startPoint, distance) {
    let dx;
    let dy;
    if (startPoint.name === this.p2.name) {
      dx = this.p1.x - this.p2.x;
      dy = this.p1.y - this.p2.y;
    } else {
      dx = this.p2.x - this.p1.x;
      dy = this.p2.y - this.p1.y;
    }
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      if (distance === 0) {
        return new PointNativeObject(startPoint.x, startPoint.y);
      }
      throw new Error("Cannot calculate point on a zero-length segment (p1 and p2 are the same).");
    }
    const scale = distance / length;
    const newX = startPoint.x + dx * scale;
    const newY = startPoint.y + dy * scale;
    return new PointNativeObject(newX, newY);
  }
  // 取得该直线的方向向量
  get directionVector() {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    if (dx === 0 && dy === 0) {
      throw new Error("Cannot calculate slope for a point.");
    }
    if (dx === 0) {
      return new PointNativeObject(0, dy > 0 ? 1 : -1);
    }
    if (dy === 0) {
      return new PointNativeObject(dx > 0 ? 1 : -1, 0);
    }
    return new PointNativeObject(dx > 0 ? 1 : -1, dy / dx);
  }
  // 获取某点的垂线上的一个点
  perpendicularLineThroughPoint(point) {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    if (dx === 0 && dy === 0) {
      throw new Error("Cannot calculate a perpendicular line for a single point object.");
    }
    const perpendicularPointX = point.x - dy;
    const perpendicularPointY = point.y + dx;
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
  parallelLineThroughPoint(throughPoint, distance) {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      throw new Error("Cannot define a parallel line for a zero-length segment (p1 and p2 are the same).");
    }
    const moveDistance = distance ?? length;
    const scale = moveDistance / length;
    const newX = throughPoint.x + dx * scale;
    const newY = throughPoint.y + dy * scale;
    return new PointNativeObject(newX, newY);
  }
  randomPointOnLine(start, end) {
    const t = Math.random() * (end - start) + start;
    const x = this.p1.x + t * (this.p2.x - this.p1.x);
    const y = this.p1.y + t * (this.p2.y - this.p1.y);
    return new PointNativeObject(x, y);
  }
  IntersectionWithLine(other) {
    const x1 = this.p1.x;
    const y1 = this.p1.y;
    const x2 = this.p2.x;
    const y2 = this.p2.y;
    const x3 = other.p1.x;
    const y3 = other.p1.y;
    const x4 = other.p2.x;
    const y4 = other.p2.y;
    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denominator) < 1e-9) {
      return null;
    }
    const tNumerator = (x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4);
    const t = tNumerator / denominator;
    const intersectX = x1 + t * (x2 - x1);
    const intersectY = y1 + t * (y2 - y1);
    return new PointNativeObject(intersectX, intersectY);
  }
};
var Line = class extends LinearObject {
  constructor(name, p1, p2) {
    super(name, "line", p1, p2);
  }
  draw(ctx, transform, options) {
    ctx.save();
    ctx.beginPath();
    this.applyStrokeStyle(ctx, options);
    const start = toScreenPoint(this.p1.x, this.p1.y, transform);
    const through = toScreenPoint(this.p2.x, this.p2.y, transform);
    const dx = through.x - start.x;
    const dy = through.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 1e-9) {
      ctx.restore();
      return;
    }
    const ux = dx / distance;
    const uy = dy / distance;
    const anchorX = (start.x + through.x) / 2;
    const anchorY = (start.y + through.y) / 2;
    const extent = this.resolveDrawExtent(ctx, transform, options, anchorX, anchorY, ux, uy, -Infinity, false);
    if (!extent) {
      ctx.restore();
      return;
    }
    ctx.moveTo(anchorX + ux * extent[0], anchorY + uy * extent[0]);
    ctx.lineTo(anchorX + ux * extent[1], anchorY + uy * extent[1]);
    ctx.stroke();
    ctx.restore();
  }
};
var Segment = class extends LinearObject {
  constructor(name, p1, p2) {
    super(name, "segment", p1, p2);
  }
  // 使用getter计算长度
  get length() {
    return this.p1.distanceTo(this.p2);
  }
  draw(ctx, transform, options) {
    ctx.save();
    ctx.beginPath();
    this.applyStrokeStyle(ctx, options);
    const start = toScreenPoint(this.p1.x, this.p1.y, transform);
    const through = toScreenPoint(this.p2.x, this.p2.y, transform);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(through.x, through.y);
    ctx.stroke();
    ctx.restore();
  }
};
var Ray = class extends LinearObject {
  // 注意，对于射线，p1是起点，p2是方向点
  constructor(name, start, through) {
    super(name, "ray", start, through);
  }
  get startPoint() {
    return this.p1;
  }
  get directionPoint() {
    return this.p2;
  }
  // 在射线上取一个给定长度的点
  pointAtDistance(startPoint, distance) {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      throw new Error("Direction vector cannot be zero.");
    }
    const scale = distance / length;
    return new PointNativeObject(startPoint.x + dx * scale, startPoint.y + dy * scale);
  }
  draw(ctx, transform, options) {
    ctx.save();
    ctx.beginPath();
    this.applyStrokeStyle(ctx, options);
    const start = toScreenPoint(this.p1.x, this.p1.y, transform);
    const through = toScreenPoint(this.p2.x, this.p2.y, transform);
    const dx = through.x - start.x;
    const dy = through.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 1e-9) {
      ctx.restore();
      return;
    }
    const ux = dx / distance;
    const uy = dy / distance;
    const extent = this.resolveDrawExtent(ctx, transform, options, start.x, start.y, ux, uy, 0, true);
    if (!extent) {
      ctx.restore();
      return;
    }
    ctx.moveTo(start.x + ux * extent[0], start.y + uy * extent[0]);
    ctx.lineTo(start.x + ux * extent[1], start.y + uy * extent[1]);
    ctx.stroke();
    ctx.restore();
  }
};

// AiGeometryBroad/src/core/geometry/Circle.ts
var Circle = class _Circle extends GeometricObject {
  center;
  _radius;
  // 主构造函数，接受圆心和半径
  constructor(name, center, radius) {
    super(name, "circle");
    this.center = center;
    this._radius = radius;
  }
  // 静态工厂方法，对应DSL的 CIRCLE 命令
  static fromRadius(name, center, radius) {
    if (radius <= 0) {
      throw new Error("Circle radius must be positive.");
    }
    return new _Circle(name, center, radius);
  }
  // 静态工厂方法，对应DSL的 CIRCLE_BY_POINT 命令
  static fromPointOnEdge(name, center, pointOnEdge) {
    const radius = center.distanceTo(pointOnEdge);
    return new _Circle(name, center, radius);
  }
  static distanceTo(p1, p2) {
    return Math.sqrt((p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y));
  }
  // 静态工厂方法，使用一条弦和圆心创建圆
  static fromChord(name, center, chordStart, chordEnd) {
    const midPoint = new PointNativeObject(
      (chordStart.x + chordEnd.x) / 2,
      (chordStart.y + chordEnd.y) / 2
    );
    const distance = _Circle.distanceTo(center, midPoint);
    const halfChordLength = chordStart.distanceTo(chordEnd) / 2;
    const radius = Math.sqrt(distance * distance + halfChordLength * halfChordLength);
    return new _Circle(name, center, radius);
  }
  // 静态工厂方法，使用一条弦和弦对应的圆心角创建圆，这个可以做出两个圆，如果角度为pi，那么c2和c1是同一个圆
  // public static fromChordAndAngle(name_1: string, name_2: string, chord: Segment, angle: number): { c1: Circle, c2: Circle } {
  //     const midPoint = new PointNativeObject(
  //         (chord.p1.x + chord.p2.x) / 2,
  //         (chord.p1.y + chord.p2.y) / 2
  //     );
  //     const halfAngle = angle / 2;
  //     if (GeometricObject.isZero(Math.cos(halfAngle))) {
  //         // 弦是直径
  //         const circleCenter = new Point(name_1 + '<_circle_center>', midPoint.x, midPoint.y);
  //         const circle = new Circle(name_1, circleCenter, chord.length / 2);
  //         return { c1: circle, c2: circle };
  //     }
  //     // 处理异常情况：圆心角为 0 或 2π 的倍数
  //     if (GeometricObject.isZero(Math.sin(halfAngle))) {
  //         throw new Error("Angle cannot be 0 or a multiple of 2π, as this would imply an infinite radius for a non-zero chord.");
  //     }
  //     // 2. 使用半角公式计算半径
  //     // 在由半径(斜边)、半弦长和圆心到弦的距离(h)构成的直角三角形中，
  //     // sin(halfAngle) = (chord.length / 2) / radius
  //     const halfChordLength = chord.length / 2;
  //     const radius = halfChordLength / Math.sin(halfAngle);
  //     // 3. 计算圆心到弦中点的距离 h
  //     // cos(halfAngle) = h / radius  =>  h = radius * cos(halfAngle)
  //     // 或者使用 tan: tan(halfAngle) = halfChordLength / h => h = halfChordLength / tan(halfAngle)
  //     const h = halfChordLength / Math.tan(halfAngle);
  //     // 4. 计算从弦的一个端点到另一个端点的向量
  //     const dx = chord.p2.x - chord.p1.x;
  //     const dy = chord.p2.y - chord.p1.y;
  //     // 5. 计算一个垂直于弦的向量。如果弦向量是 (dx, dy)，则垂直向量是 (-dy, dx)。
  //     // 这个垂直向量的长度恰好也等于弦长 `chord.length`。
  //     // 我们需要将其缩放，使其长度等于 h。
  //     // 缩放因子 = h / chord.length
  //     const scale = h / chord.length;
  //     const offsetX = -dy * scale;
  //     const offsetY = dx * scale;
  //     // 6. 计算两个可能的圆心
  //     // 从中点分别加上和减去这个偏移向量
  //     const center1 = new Point(
  //         name_1 + '_<circle_center>',
  //         midPoint.x + offsetX,
  //         midPoint.y + offsetY
  //     );
  //     const center2 = new Point(
  //         name_2 + '_<circle_center>',
  //         midPoint.x - offsetX,
  //         midPoint.y - offsetY
  //     );
  //     // 7. 创建两个圆并返回
  //     const c1 = new Circle(name_1, center1, radius);
  //     const c2 = new Circle(name_2, center2, radius);
  //     return { c1, c2 };
  // }
  /**
      * Creates a Circle instance representing the circumcircle of a triangle defined by three points.
      * The circumcircle passes through all three vertices of the triangle.
      * @param name The name of the new circle.
      * @param p1 The first vertex of the triangle.
      * @param p2 The second vertex of the triangle.
      * @param p3 The third vertex of the triangle.
      * @returns A new Circle object.
      * @throws An error if the three points are collinear.
      */
  static fromCircumcircle(p1, p2, p3) {
    const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
    if (Math.abs(D) < 1e-9) {
      throw new Error("Cannot create a circumcircle for collinear points.");
    }
    const p1_sq = p1.x * p1.x + p1.y * p1.y;
    const p2_sq = p2.x * p2.x + p2.y * p2.y;
    const p3_sq = p3.x * p3.x + p3.y * p3.y;
    const centerX = (p1_sq * (p2.y - p3.y) + p2_sq * (p3.y - p1.y) + p3_sq * (p1.y - p2.y)) / D;
    const centerY = (p1_sq * (p3.x - p2.x) + p2_sq * (p1.x - p3.x) + p3_sq * (p2.x - p1.x)) / D;
    const center = new PointNativeObject(centerX, centerY);
    const radius = Math.sqrt((centerX - p1.x) ** 2 + (centerY - p1.y) ** 2);
    return { pt: center, radius };
  }
  /**
      * Creates a Circle instance representing the incircle of a triangle defined by three points.
      * The incircle is tangent to all three sides of the triangle.
      * @param name The name of the new circle.
      * @param p1 The first vertex of the triangle.
      * @param p2 The second vertex of the triangle.
      * @param p3 The third vertex of the triangle.
      * @returns A new Circle object.
      * @throws An error if the three points are collinear.
      */
  static fromIncircle(p1, p2, p3) {
    const a = p2.distanceTo(p3);
    const b = p1.distanceTo(p3);
    const c = p1.distanceTo(p2);
    const perimeter = a + b + c;
    if (Math.abs(perimeter - 2 * Math.max(a, b, c)) < 1e-9) {
      throw new Error("Cannot create an incircle for collinear points.");
    }
    const centerX = (a * p1.x + b * p2.x + c * p3.x) / perimeter;
    const centerY = (a * p1.y + b * p2.y + c * p3.y) / perimeter;
    const s = perimeter / 2;
    const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
    const radius = area / s;
    return { pt: new PointNativeObject(centerX, centerY), radius };
  }
  /**
   * Generates a random point on the edge of the circle.
   * @return {PointNativeObject} A point on the edge of the circle.
   * */
  randomPointOnEdge(startAngel, endAngle) {
    if (this._radius <= 0) {
      throw new Error("Circle radius must be positive.");
    }
    let angle = Math.random() * 360;
    if (startAngel !== void 0 && endAngle !== void 0) {
      if (startAngel > endAngle) {
        throw new Error("startAngle must be less than or equal to endAngle.");
      }
      angle = startAngel + Math.random() * (endAngle - startAngel);
    }
    let realAngle = angle * (Math.PI / 180);
    const x = this.center.x + this._radius * Math.cos(realAngle);
    const y = this.center.y + this._radius * Math.sin(realAngle);
    return new PointNativeObject(x, y);
  }
  /**
   * [私有辅助函数] 计算两个圆的交点。
   * @param c1 第一个圆对象
   * @param c2 第二个圆对象
   * @returns 返回一个包含交点 Point 对象的数组。
   */
  _findCircleCircleIntersection(c1, c2) {
    const p1 = c1.center;
    const r1 = c1.radius;
    const p2 = c2.center;
    const r2 = c2.radius;
    const d = p1.distanceTo(p2);
    if (d > r1 + r2 || d < Math.abs(r1 - r2)) {
      return [];
    }
    if (d === 0 && r1 === r2) {
      return [];
    }
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const p_mid_x = p1.x + a * (p2.x - p1.x) / d;
    const p_mid_y = p1.y + a * (p2.y - p1.y) / d;
    const i1_x = p_mid_x + h * (p2.y - p1.y) / d;
    const i1_y = p_mid_y - h * (p2.x - p1.x) / d;
    const i1 = new Point("", i1_x, i1_y);
    if (h < 1e-9) {
      return [i1];
    }
    const i2_x = p_mid_x - h * (p2.y - p1.y) / d;
    const i2_y = p_mid_y + h * (p2.x - p1.x) / d;
    const i2 = new Point("", i2_x, i2_y);
    return [i1, i2];
  }
  /**
   * 计算圆外一个点到圆上某个点距离等于指定距离的点。
   * @param p 圆外的一个点
   * @param distance 距离
   */
  getPointAtDistanceFromTarget(p, distance) {
    const helperCircle = new _Circle("helper_circle", p, distance);
    const intersectionPoints = this._findCircleCircleIntersection(this, helperCircle);
    return intersectionPoints.map((point) => new PointNativeObject(point.x, point.y));
  }
  /**
   * 计算圆与直线的交点。
   * @param line 直线对象
   */
  getIntersectionWithLine(line) {
    const p1 = line.p1;
    const p2 = line.p2;
    const center = this.center;
    const r = this.radius;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const A = dx * dx + dy * dy;
    const B = 2 * (dx * (p1.x - center.x) + dy * (p1.y - center.y));
    const C = (p1.x - center.x) ** 2 + (p1.y - center.y) ** 2 - r * r;
    if (Math.abs(A) < 1e-9) {
      return [];
    }
    const delta = B * B - 4 * A * C;
    const intersectionPoints = [];
    if (delta < -1e-9) {
      return [];
    } else if (Math.abs(delta) < 1e-9) {
      const t = -B / (2 * A);
      const intersectX = p1.x + t * dx;
      const intersectY = p1.y + t * dy;
      intersectionPoints.push(new PointNativeObject(intersectX, intersectY));
    } else {
      const sqrtDelta = Math.sqrt(delta);
      const t1 = (-B + sqrtDelta) / (2 * A);
      const intersectX1 = p1.x + t1 * dx;
      const intersectY1 = p1.y + t1 * dy;
      intersectionPoints.push(new PointNativeObject(intersectX1, intersectY1));
      const t2 = (-B - sqrtDelta) / (2 * A);
      const intersectX2 = p1.x + t2 * dx;
      const intersectY2 = p1.y + t2 * dy;
      intersectionPoints.push(new PointNativeObject(intersectX2, intersectY2));
    }
    return intersectionPoints;
  }
  get radius() {
    return this._radius;
  }
  get r() {
    return this._radius;
  }
  get c() {
    return this.center;
  }
  get diameter() {
    return this._radius * 2;
  }
  get area() {
    return Math.PI * this._radius * this._radius;
  }
  get circumference() {
    return 2 * Math.PI * this._radius;
  }
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const padding = options.padding || 0;
    const actualTextWidth = textWidth + padding * 2;
    const actualTextHeight = textHeight + padding * 2;
    const offsetDistance = this._radius + Math.max(actualTextWidth, actualTextHeight) / 2 / transform.scale + 10 / transform.scale;
    let labelX = this.center.x;
    let labelY = this.center.y;
    if (options.drawDirection) {
      switch (options.drawDirection) {
        case "down":
          labelY += offsetDistance;
          break;
        case "up":
          labelY -= offsetDistance;
          break;
        case "left":
          labelX -= offsetDistance;
          break;
        case "right":
          labelX += offsetDistance;
          break;
      }
    } else {
      const defaultAngle = -Math.PI / 4;
      labelX += Math.cos(defaultAngle) * offsetDistance;
      labelY += Math.sin(defaultAngle) * offsetDistance;
    }
    return toScreenPoint(labelX, labelY, transform);
  }
  draw(ctx, transform, options) {
    ctx.save();
    ctx.beginPath();
    const transformedCenterX = this.center.x * transform.scale + transform.offsetX;
    const transformedCenterY = this.center.y * transform.scale - transform.offsetY;
    const transformedRadius = this._radius * transform.scale;
    ctx.arc(transformedCenterX, 0 - transformedCenterY, transformedRadius, 0, 2 * Math.PI);
    if (options?.fillColor) {
      ctx.fillStyle = options.fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = options?.color || "black";
    ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
    if (options?.dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.restore();
  }
};

// AiGeometryBroad/src/core/geometry/Ellipse.ts
var Ellipse = class extends GeometricObject {
  center;
  rx;
  // 半长轴
  ry;
  // 半短轴
  rotation;
  // 旋转角度 (弧度)
  constructor(name, center, rx, ry, rotationDegrees = 0) {
    super(name, "ellipse");
    this.center = center;
    this.rx = rx;
    this.ry = ry;
    this.rotation = rotationDegrees * (Math.PI / 180);
  }
  draw(ctx, transform, options) {
    ctx.save();
    ctx.beginPath();
    const centerTransformed = this.center.transform(transform.scale, transform.offsetX, transform.offsetY);
    const transformedRx = this.rx * transform.scale;
    const transformedRy = this.ry * transform.scale;
    ctx.ellipse(centerTransformed.x, 0 - centerTransformed.y, transformedRx, transformedRy, 0 - this.rotation, 0, 2 * Math.PI);
    if (options?.fillColor) {
      ctx.fillStyle = options.fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = options?.color || "black";
    ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
    if (options?.dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.restore();
  }
  /**
  * 私有辅助方法：将一个相对于椭圆中心的局部坐标点进行旋转和平移，转换为世界坐标。
  * @param localX 局部x坐标
  * @param localY 局部y坐标
  * @param name 新点的名称
  * @returns 转换后的 Point 对象
  */
  _getTransformedPoint(localX, localY) {
    const cosR = Math.cos(this.rotation);
    const sinR = Math.sin(this.rotation);
    const rotatedX = localX * cosR - localY * sinR;
    const rotatedY = localX * sinR + localY * cosR;
    const finalX = rotatedX + this.center.x;
    const finalY = rotatedY + this.center.y;
    return new PointNativeObject(finalX, finalY);
  }
  /**
  * 计算并返回椭圆的两个焦点。
  * @returns {PointNativeObject[]} 包含两个焦点的数组。如果椭圆是圆，则两个焦点重合于圆心。
  */
  getFoci() {
    const a = Math.max(this.rx, this.ry);
    const b = Math.min(this.rx, this.ry);
    const c_squared = a * a - b * b;
    if (c_squared < 1e-9) {
      return [this.center, this.center];
    }
    const c = Math.sqrt(c_squared);
    let f1_localX, f1_localY, f2_localX, f2_localY;
    if (this.rx > this.ry) {
      f1_localX = c;
      f1_localY = 0;
      f2_localX = -c;
      f2_localY = 0;
    } else {
      f1_localX = 0;
      f1_localY = c;
      f2_localX = 0;
      f2_localY = -c;
    }
    const f1 = this._getTransformedPoint(f1_localX, f1_localY);
    const f2 = this._getTransformedPoint(f2_localX, f2_localY);
    return [f1, f2];
  }
  /**
  * 计算并返回椭圆的四个顶点（长轴和短轴的端点）。
  * @returns {{major: Point[], minor: Point[]}} 一个包含主轴和次轴顶点的对象。
  */
  getVertices() {
    const a = Math.max(this.rx, this.ry);
    const b = Math.min(this.rx, this.ry);
    let v_major1_localX, v_major1_localY, v_major2_localX, v_major2_localY;
    let v_minor1_localX, v_minor1_localY, v_minor2_localX, v_minor2_localY;
    if (this.rx > this.ry) {
      v_major1_localX = a;
      v_major1_localY = 0;
      v_major2_localX = -a;
      v_major2_localY = 0;
      v_minor1_localX = 0;
      v_minor1_localY = b;
      v_minor2_localX = 0;
      v_minor2_localY = -b;
    } else {
      v_major1_localX = 0;
      v_major1_localY = a;
      v_major2_localX = 0;
      v_major2_localY = -a;
      v_minor1_localX = b;
      v_minor1_localY = 0;
      v_minor2_localX = -b;
      v_minor2_localY = 0;
    }
    const major = [
      this._getTransformedPoint(v_major1_localX, v_major1_localY),
      this._getTransformedPoint(v_major2_localX, v_major2_localY)
    ];
    const minor = [
      this._getTransformedPoint(v_minor1_localX, v_minor1_localY),
      this._getTransformedPoint(v_minor2_localX, v_minor2_localY)
    ];
    return { major, minor };
  }
  /**
   * 计算并返回椭圆的两条准线。
   * 准线是通过线上两点来定义的。
   * @returns {DirectrixLine[]} 包含两条准线的数组。
   * @throws 如果椭圆是圆，则抛出错误，因为圆的准线在无穷远处。
   */
  getDirectrices() {
    const a = Math.max(this.rx, this.ry);
    const b = Math.min(this.rx, this.ry);
    const c_squared = a * a - b * b;
    if (Math.abs(c_squared) < 1e-9) {
      throw new Error("A circle does not have directrices (they are at infinity).");
    }
    const c = Math.sqrt(c_squared);
    const d = a * a / c;
    const lineLength = Math.max(a, b) * 2;
    let p1_d1, p2_d1, p1_d2, p2_d2;
    if (this.rx > this.ry) {
      p1_d1 = this._getTransformedPoint(d, -lineLength);
      p2_d1 = this._getTransformedPoint(d, lineLength);
      p1_d2 = this._getTransformedPoint(-d, -lineLength);
      p2_d2 = this._getTransformedPoint(-d, lineLength);
    } else {
      p1_d1 = this._getTransformedPoint(-lineLength, d);
      p2_d1 = this._getTransformedPoint(lineLength, d);
      p1_d2 = this._getTransformedPoint(-lineLength, -d);
      p2_d2 = this._getTransformedPoint(lineLength, -d);
    }
    return [new LinearNativeObject(p1_d1, p2_d1), new LinearNativeObject(p1_d2, p2_d2)];
  }
  randomPointOnEdge(startAngel, endAngle) {
    let angle = Math.random() * 360;
    if (startAngel !== void 0 && endAngle !== void 0) {
      if (startAngel > endAngle) {
        throw new Error("startAngle must be less than or equal to endAngle.");
      }
      angle = startAngel + Math.random() * (endAngle - startAngel);
    }
    let realAngle = angle * (Math.PI / 180);
    const cosR = Math.cos(this.rotation);
    const sinR = Math.sin(this.rotation);
    const x = this.center.x + this.rx * Math.cos(realAngle) * cosR - this.ry * Math.sin(realAngle) * sinR;
    const y = this.center.y + this.rx * Math.cos(realAngle) * sinR + this.ry * Math.sin(realAngle) * cosR;
    return new PointNativeObject(x, y);
  }
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const padding = options.padding || 0;
    const actualTextWidth = textWidth + padding * 2;
    const actualTextHeight = textHeight + padding * 2;
    let labelX = this.center.x;
    let labelY = this.center.y;
    if (options.drawDirection) {
      let directionAngle;
      let baseDistance;
      switch (options.drawDirection) {
        case "down":
          directionAngle = Math.PI / 2;
          break;
        case "up":
          directionAngle = -Math.PI / 2;
          break;
        case "left":
          directionAngle = Math.PI;
          break;
        case "right":
          directionAngle = 0;
          break;
        default:
          directionAngle = 0;
      }
      const adjustedAngle = directionAngle - this.rotation;
      const ellipseRadius = this.rx * this.ry / Math.sqrt(
        Math.pow(this.ry * Math.cos(adjustedAngle), 2) + Math.pow(this.rx * Math.sin(adjustedAngle), 2)
      );
      const offsetDistance = ellipseRadius + Math.max(actualTextWidth, actualTextHeight) / 2 / transform.scale + 10 / transform.scale;
      labelX += Math.cos(directionAngle) * offsetDistance;
      labelY += Math.sin(directionAngle) * offsetDistance;
    } else {
      let defaultAngle = -Math.PI / 4;
      if (Math.abs(this.rotation) > 0.1) {
        defaultAngle = this.rotation - Math.PI / 4;
      }
      const adjustedAngle = defaultAngle - this.rotation;
      const ellipseRadius = this.rx * this.ry / Math.sqrt(
        Math.pow(this.ry * Math.cos(adjustedAngle), 2) + Math.pow(this.rx * Math.sin(adjustedAngle), 2)
      );
      const offsetDistance = ellipseRadius + Math.max(actualTextWidth, actualTextHeight) / 2 / transform.scale + 10 / transform.scale;
      labelX += Math.cos(defaultAngle) * offsetDistance;
      labelY += Math.sin(defaultAngle) * offsetDistance;
    }
    return toScreenPoint(labelX, labelY, transform);
  }
};

// AiGeometryBroad/src/core/geometry/Polygon.ts
var Polygon = class extends GeometricObject {
  vertices;
  constructor(name, vertices, type = "polygon") {
    if (vertices.length < 3) {
      throw new Error("A polygon must have at least 3 vertices.");
    }
    super(name, type);
    this.vertices = vertices;
  }
  // 获取多边形的边（作为线段对象）
  get edges() {
    const edges = [];
    for (let i = 0; i < this.vertices.length; i++) {
      const p1 = this.vertices[i];
      const p2 = this.vertices[(i + 1) % this.vertices.length];
      edges.push(new Segment(`edge_${p1.name}_${p2.name}`, p1, p2));
    }
    return edges;
  }
  // 计算面积 (使用鞋带公式)
  get area() {
    let area = 0;
    for (let i = 0; i < this.vertices.length; i++) {
      const p1 = this.vertices[i];
      const p2 = this.vertices[(i + 1) % this.vertices.length];
      area += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(area / 2);
  }
  draw(ctx, transform, options) {
    ctx.beginPath();
    if (this.vertices.length > 0) {
      const firstPoint = this.vertices[0].transform(transform.scale, transform.offsetX, transform.offsetY);
      ctx.moveTo(firstPoint.x, 0 - firstPoint.y);
      for (let i = 1; i < this.vertices.length; i++) {
        const point = this.vertices[i].transform(transform.scale, transform.offsetX, transform.offsetY);
        ctx.lineTo(point.x, 0 - point.y);
      }
      ctx.closePath();
      if (options?.fillColor) {
        ctx.fillStyle = options.fillColor;
        ctx.fill();
      }
      ctx.strokeStyle = options?.color || "black";
      ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
      if (options?.dashed) {
        ctx.setLineDash([5, 5]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
  }
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const centerX = this.vertices.reduce((sum, v) => sum + v.x, 0) / this.vertices.length;
    const centerY = this.vertices.reduce((sum, v) => sum + v.y, 0) / this.vertices.length;
    return toScreenPoint(centerX, centerY, transform);
  }
};
var Region = class extends Polygon {
  constructor(name, vertices) {
    super(name, vertices, "region");
  }
};
var CircularRegion = class extends GeometricObject {
  circle;
  line;
  startPoint;
  endPoint;
  arcStartAngle;
  arcEndAngle;
  counterclockwise;
  side;
  constructor(name, circle, line, startPoint, endPoint, arcStartAngle, arcEndAngle, counterclockwise, side) {
    super(name, "circular-region");
    this.circle = circle;
    this.line = line;
    this.startPoint = startPoint;
    this.endPoint = endPoint;
    this.arcStartAngle = arcStartAngle;
    this.arcEndAngle = arcEndAngle;
    this.counterclockwise = counterclockwise;
    this.side = side;
  }
  draw(ctx, transform, options) {
    const center = toScreenPoint(this.circle.center.x, this.circle.center.y, transform);
    const start = toScreenPoint(this.startPoint.x, this.startPoint.y, transform);
    const end = toScreenPoint(this.endPoint.x, this.endPoint.y, transform);
    const radius = Math.abs(this.circle.radius * transform.scale);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.arc(center.x, center.y, radius, this.arcStartAngle, this.arcEndAngle, this.counterclockwise);
    ctx.closePath();
    if (options?.fillColor) {
      ctx.fillStyle = options.fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = options?.color || "black";
    ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
    ctx.setLineDash(options?.dashed ? [5, 5] : []);
    ctx.stroke();
    ctx.restore();
  }
  getDrawLabelPosition(transform, _options, _textWidth, _textHeight) {
    return toScreenPoint(this.circle.center.x, this.circle.center.y, transform);
  }
};
var CurveCircleRegion = class extends GeometricObject {
  curve;
  circle;
  curvePoints;
  arcStartAngle;
  arcEndAngle;
  counterclockwise;
  side;
  constructor(name, curve, circle, curvePoints, arcStartAngle, arcEndAngle, counterclockwise, side) {
    super(name, "curve-circle-region");
    this.curve = curve;
    this.circle = circle;
    this.curvePoints = curvePoints;
    this.arcStartAngle = arcStartAngle;
    this.arcEndAngle = arcEndAngle;
    this.counterclockwise = counterclockwise;
    this.side = side;
  }
  draw(ctx, transform, options) {
    if (this.curvePoints.length < 2) return;
    const center = toScreenPoint(this.circle.center.x, this.circle.center.y, transform);
    const radius = Math.abs(this.circle.radius * transform.scale);
    const first = toScreenPoint(this.curvePoints[0].x, this.curvePoints[0].y, transform);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < this.curvePoints.length; i++) {
      const point = toScreenPoint(this.curvePoints[i].x, this.curvePoints[i].y, transform);
      ctx.lineTo(point.x, point.y);
    }
    ctx.arc(center.x, center.y, radius, this.arcStartAngle, this.arcEndAngle, this.counterclockwise);
    ctx.closePath();
    if (options?.fillColor) {
      ctx.fillStyle = options.fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = options?.color || "black";
    ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
    ctx.setLineDash(options?.dashed ? [5, 5] : []);
    ctx.stroke();
    ctx.restore();
  }
  getDrawLabelPosition(transform, _options, _textWidth, _textHeight) {
    const middle = this.curvePoints[Math.floor(this.curvePoints.length / 2)];
    return toScreenPoint(middle.x, middle.y, transform);
  }
};
var Triangle = class extends Polygon {
  constructor(name, p1, p2, p3) {
    super(name, [p1, p2, p3], "triangle");
  }
  get p1() {
    return this.vertices[0];
  }
  get p2() {
    return this.vertices[1];
  }
  get p3() {
    return this.vertices[2];
  }
};
var Rectangle = class _Rectangle extends Polygon {
  // 静态工厂方法，对应 DSL 的 RECTANGLE 指令
  static fromThreePoints(name, p1, p2, p3) {
    const v21 = { x: p1.x - p2.x, y: p1.y - p2.y };
    const v23 = { x: p3.x - p2.x, y: p3.y - p2.y };
    const dotProduct = v21.x * v23.x + v21.y * v23.y;
    if (Math.abs(dotProduct) > 1e-6) {
      console.warn(`The three points for RECTANGLE ${name} do not form a right angle. A parallelogram will be formed instead.`);
    }
    const p4_x = p1.x + v23.x;
    const p4_y = p1.y + v23.y;
    const p4 = new Point(`${name}_p4`, p4_x, p4_y);
    return new _Rectangle(name, [p1, p2, p3, p4]);
  }
  static fromWidthHeight(name, p1, width, height) {
    const p2 = new Point(`${name}_p2`, p1.x + width, p1.y);
    const p3 = new Point(`${name}_p3`, p2.x, p2.y - height);
    const p4 = new Point(`${name}_p4`, p1.x, p1.y - height);
    return new _Rectangle(name, [p1, p2, p3, p4]);
  }
  constructor(name, vertices) {
    super(name, vertices, "rectangle");
  }
};

// AiGeometryBroad/src/core/geometry/Angle.ts
var Angle = class _Angle extends GeometricObject {
  _value;
  // Angle value in radians
  _vertex;
  _point1;
  _point2;
  _line1;
  _line2;
  _showArc;
  constructor(name, vertex, point1, point2, showArc) {
    super(name, "Angle");
    this._vertex = vertex;
    this._point1 = point1;
    this._point2 = point2;
    this._value = this.calculateAngleFromPoints();
    if (showArc !== void 0) {
      this._showArc = showArc;
    } else {
      this._showArc = true;
    }
  }
  calculateAngleFromPoints() {
    if (!this._vertex || !this._point1 || !this._point2) {
      return 0;
    }
    const v1x = this._point1.x - this._vertex.x;
    const v1y = this._point1.y - this._vertex.y;
    const v2x = this._point2.x - this._vertex.x;
    const v2y = this._point2.y - this._vertex.y;
    const dotProduct = v1x * v2x + v1y * v2y;
    const magnitude1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const magnitude2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }
    let angle = Math.acos(dotProduct / (magnitude1 * magnitude2));
    const crossProduct = v1x * v2y - v1y * v2x;
    if (crossProduct < 0) {
      angle = -angle;
    }
    return angle;
  }
  get value() {
    return this._value;
  }
  get vertex() {
    return this._vertex;
  }
  get point1() {
    return this._point1;
  }
  get p1() {
    return this._point1;
  }
  get point2() {
    return this._point2;
  }
  get p2() {
    return this._point2;
  }
  get line1() {
    if (!this._line1) {
      this._line1 = new Ray(`${this.name}_line1`, this._vertex, this._point1);
    }
    return this._line1;
  }
  get l1() {
    return this.line1;
  }
  get line2() {
    if (!this._line2) {
      this._line2 = new Ray(`${this.name}_line2`, this._vertex, this._point2);
    }
    return this._line2;
  }
  get l2() {
    return this.line2;
  }
  get degreesValue() {
    return this._value * (180 / Math.PI);
  }
  toRadians() {
    return this._value;
  }
  draw(ctx, transform, options) {
    if (!this._vertex || !this._point1 || !this._point2) {
      return;
    }
    const { scale, offsetX, offsetY } = transform;
    const defaultOptions = { color: "black", lineWidth: 1, fillColor: "rgba(0,0,0,0)" };
    const drawOptions = { ...defaultOptions, ...options };
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = drawOptions.color;
    ctx.lineWidth = drawOptions.lineWidth;
    if (drawOptions.dashed) {
      ctx.setLineDash([5, 5]);
    }
    const vertex = this._vertex.transform(scale, offsetX, offsetY);
    const p1 = this._point1.transform(scale, offsetX, offsetY);
    const p2 = this._point2.transform(scale, offsetX, offsetY);
    if (this._showArc) {
      const startAngle = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);
      const endAngle = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
      const radius = 10 * scale;
      ctx.arc(vertex.x, 0 - vertex.y, radius, 0 - startAngle, 0 - endAngle);
      ctx.stroke();
    }
    ctx.moveTo(vertex.x, 0 - vertex.y);
    ctx.lineTo(p1.x, 0 - p1.y);
    ctx.stroke();
    ctx.moveTo(vertex.x, 0 - vertex.y);
    ctx.lineTo(p2.x, 0 - p2.y);
    ctx.stroke();
    ctx.restore();
  }
  static fromPoints(name, vertex, point1, point2) {
    return new _Angle(name, vertex, point1, point2);
  }
  /**
   * Rotates the first arm of the angle (vertex -> point1) by a given angle.
   * @param theta The angle of rotation in degrees.
   * @param newPointName The name for the new Point object being created.
   * @returns {Point} A new Point object representing the rotated position of the original point1.
   */
  getRotatedPoint1(theta) {
    const p1RelativeX = this._point1.x - this._vertex.x;
    const p1RelativeY = this._point1.y - this._vertex.y;
    const realTheta = theta * (Math.PI / 180);
    const cosTheta = Math.cos(realTheta);
    const sinTheta = Math.sin(realTheta);
    const rotatedX = p1RelativeX * cosTheta - p1RelativeY * sinTheta;
    const rotatedY = p1RelativeX * sinTheta + p1RelativeY * cosTheta;
    const finalX = rotatedX + this._vertex.x;
    const finalY = rotatedY + this._vertex.y;
    return new PointNativeObject(finalX, finalY);
  }
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const vector1 = {
      x: this._point1.x - this._vertex.x,
      y: this._point1.y - this._vertex.y
    };
    const vector2 = {
      x: this._point2.x - this._vertex.x,
      y: this._point2.y - this._vertex.y
    };
    const angle1 = Math.atan2(vector1.y, vector1.x);
    const angle2 = Math.atan2(vector2.y, vector2.x);
    let bisectorAngle = (angle1 + angle2) / 2;
    const angleDiff = angle2 - angle1;
    if (Math.abs(angleDiff) > Math.PI) {
      if (angleDiff > 0) {
        bisectorAngle += Math.PI;
      } else {
        bisectorAngle -= Math.PI;
      }
    }
    while (bisectorAngle > Math.PI) bisectorAngle -= 2 * Math.PI;
    while (bisectorAngle < -Math.PI) bisectorAngle += 2 * Math.PI;
    const labelDistance = Math.max(
      30 / transform.scale,
      // 最小距离
      Math.min(
        Math.sqrt(vector1.x * vector1.x + vector1.y * vector1.y),
        Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y)
      ) * 0.4
      // 取较短边的40%作为距离
    );
    let labelX = this._vertex.x + Math.cos(bisectorAngle) * labelDistance;
    let labelY = this._vertex.y + Math.sin(bisectorAngle) * labelDistance;
    const padding = options.padding || 0;
    const actualTextWidth = textWidth + padding * 2;
    const actualTextHeight = textHeight + padding * 2;
    if (options.drawDirection) {
      switch (options.drawDirection) {
        case "down":
          labelY += actualTextHeight / 2 / transform.scale;
          break;
        case "up":
          labelY -= actualTextHeight / 2 / transform.scale;
          break;
        case "left":
          labelX -= actualTextWidth / 2 / transform.scale;
          break;
        case "right":
          labelX += actualTextWidth / 2 / transform.scale;
          break;
      }
    } else {
      const offsetX = Math.cos(bisectorAngle) * (actualTextWidth / 2) / transform.scale;
      const offsetY = Math.sin(bisectorAngle) * (actualTextHeight / 2) / transform.scale;
      labelX += offsetX;
      labelY += offsetY;
    }
    return toScreenPoint(labelX, labelY, transform);
  }
};

// AiGeometryBroad/src/core/geometry/Parabola.ts
var Parabola = class extends GeometricObject {
  // 抛物线顶点
  vertex;
  // y^2 = 2px 这样定义的抛物线的p值
  pValue;
  // 旋转角度（度），所有的抛物线都可以看作是由 y^2=2px 旋转和平移得到的
  rotateAngle;
  constructor(name, vertex, pValue, rotateAngle) {
    super(name, "parabola");
    this.vertex = vertex;
    this.pValue = pValue;
    this.rotateAngle = rotateAngle;
  }
  /**
   * 计算并返回抛物线焦点的屏幕坐标，用于放置标签。
   */
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const localFocusX = this.pValue / 2;
    const localFocusY = 0;
    const angleRad = this.rotateAngle * (Math.PI / 180);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const rotatedX = localFocusX * cosA - localFocusY * sinA;
    const rotatedY = localFocusX * sinA + localFocusY * cosA;
    const worldX = rotatedX + this.vertex.x;
    const worldY = rotatedY + this.vertex.y;
    return toScreenPoint(worldX, worldY, transform);
  }
  /**
       * 在Canvas上绘制抛物线。
       * @param ctx - Canvas 2D 绘图上下文。
       * @param transform - 视口变换信息。
       * @param options - 绘制选项。
       */
  draw(ctx, transform, options) {
    if (this.pValue === 0) {
      return;
    }
    ctx.strokeStyle = options?.color || "black";
    ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
    ctx.setLineDash(options?.dashed ? [5, 5] : []);
    ctx.beginPath();
    const angleRad = this.rotateAngle * (Math.PI / 180);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const { width, height } = ctx.canvas;
    const screenDiagonal = Math.sqrt(width * width + height * height);
    const dynamicRange = screenDiagonal / transform.scale;
    const range = 4 * Math.abs(this.pValue) + dynamicRange;
    const step = 0.1 / transform.scale;
    let isFirstPoint = true;
    for (let yLocal = -range; yLocal <= range; yLocal += step) {
      const xLocal = yLocal * yLocal / (2 * this.pValue);
      const rotatedX = xLocal * cosA - yLocal * sinA;
      const rotatedY = xLocal * sinA + yLocal * cosA;
      const worldX = rotatedX + this.vertex.x;
      const worldY = rotatedY + this.vertex.y;
      const screenX = worldX * transform.scale + transform.offsetX;
      const screenY = worldY * transform.scale + transform.offsetY;
      if (isFirstPoint) {
        ctx.moveTo(screenX, screenY);
        isFirstPoint = false;
      } else {
        ctx.lineTo(screenX, screenY);
      }
    }
    ctx.stroke();
  }
};

// AiGeometryBroad/src/core/geometry/Hyperbola.ts
var Hyperbola = class extends GeometricObject {
  // 双曲线中心
  center;
  // 半实轴长
  aValue;
  // 半虚轴长
  bValue;
  // 旋转角度（度）
  rotateAngle;
  constructor(name, center, aValue, bValue, rotateAngle) {
    super(name, "hyperbola");
    this.center = center;
    this.aValue = aValue;
    this.bValue = bValue;
    this.rotateAngle = rotateAngle;
  }
  /**
   * 计算并返回双曲线一个焦点的屏幕坐标，用于放置标签。
   */
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const c = Math.sqrt(this.aValue * this.aValue + this.bValue * this.bValue);
    const localFocusX = c;
    const localFocusY = 0;
    const angleRad = this.rotateAngle * (Math.PI / 180);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const rotatedX = localFocusX * cosA - localFocusY * sinA;
    const rotatedY = localFocusX * sinA + localFocusY * cosA;
    const worldX = rotatedX + this.center.x;
    const worldY = rotatedY + this.center.y;
    return toScreenPoint(worldX, worldY, transform);
  }
  /**
   * 在Canvas上绘制双曲线。
   * @param ctx - Canvas 2D 绘图上下文。
   * @param transform - 视口变换信息。
   * @param options - 绘制选项。
   */
  draw(ctx, transform, options) {
    if (this.aValue === 0 || this.bValue === 0) {
      return;
    }
    ctx.strokeStyle = options?.color || "black";
    ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
    ctx.setLineDash(options?.dashed ? [5, 5] : []);
    const angleRad = this.rotateAngle * (Math.PI / 180);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const step = 1e-3;
    const rangeLimit = Math.PI / 2 - 5e-3;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      let isFirstPoint = true;
      const startT = i === 0 ? -rangeLimit : Math.PI - rangeLimit;
      const endT = i === 0 ? rangeLimit : Math.PI + rangeLimit;
      for (let t = startT; t <= endT; t += step) {
        const xLocal = this.aValue / Math.cos(t);
        const yLocal = this.bValue * Math.tan(t);
        const rotatedX = xLocal * cosA - yLocal * sinA;
        const rotatedY = xLocal * sinA + yLocal * cosA;
        const worldX = rotatedX + this.center.x;
        const worldY = rotatedY + this.center.y;
        const screenX = worldX * transform.scale + transform.offsetX;
        const screenY = worldY * transform.scale + transform.offsetY;
        if (isFirstPoint) {
          ctx.moveTo(screenX, screenY);
          isFirstPoint = false;
        } else {
          ctx.lineTo(screenX, screenY);
        }
      }
      ctx.stroke();
    }
  }
};

// AiGeometryBroad/src/core/geometry/Curve.ts
var Curve = class extends GeometricObject {
  xStart;
  xEnd;
  lambda;
  stepSize = 0.5;
  constructor(name, xStart, xEnd, lambda, stepSize) {
    super(name, "curve");
    this.xStart = xStart;
    this.xEnd = xEnd;
    this.lambda = lambda;
    if (stepSize != null) {
      this.stepSize = stepSize;
    }
  }
  get rangeStart() {
    return this.xStart;
  }
  get rangeEnd() {
    return this.xEnd;
  }
  get sampleStep() {
    return this.stepSize;
  }
  evaluate(x) {
    return this.lambda(x);
  }
  draw(ctx, transform, options) {
    ctx.beginPath();
    ctx.strokeStyle = options?.color || "black";
    ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
    if (options?.dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }
    const startPointX = this.xStart * transform.scale + transform.offsetX;
    const startPointY = this.lambda(this.xStart) * transform.scale - transform.offsetY;
    ctx.moveTo(startPointX, 0 - startPointY);
    for (let x = this.xStart + this.stepSize; x <= this.xEnd; x += this.stepSize) {
      const y = this.lambda(x);
      const currentPointX = x * transform.scale + transform.offsetX;
      const currentPointY = y * transform.scale - transform.offsetY;
      ctx.lineTo(currentPointX, 0 - currentPointY);
    }
    ctx.stroke();
  }
  getDrawLabelPosition(transform, options, textWidth, textHeight) {
    const start = new PointNativeObject(this.xStart, this.lambda(this.xStart));
    return toScreenPoint(start.x, start.y, transform);
  }
};

// AiGeometryBroad/src/core/expression.ts
var OPERATOR_PRECEDENCE = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
  "^": 3
  // 幂运算
};
var SUPPORTED_FUNCTIONS = {
  exp: Math.exp,
  log: Math.log,
  // 注意: 这是自然对数 ln
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (x) => 1 / Math.tan(x),
  // cot(x) = 1 / tan(x)
  arcsin: Math.asin,
  asin: Math.asin,
  // arcsin 和 asin 是同一个函数
  arccos: Math.acos,
  acos: Math.acos,
  arctan: Math.atan,
  atan: Math.atan,
  arctan2: Math.atan2,
  atan2: Math.atan2,
  arccot: (x) => Math.PI / 2 - Math.atan(x),
  // arccot(x) = PI/2 - arctan(x)
  acot: (x) => Math.PI / 2 - Math.atan(x),
  arccot2: (x, y) => Math.PI / 2 - Math.atan2(x, y),
  acot2: (x, y) => Math.PI / 2 - Math.atan2(x, y),
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  pow: Math.pow,
  sqrt: Math.sqrt,
  PI: () => Math.PI,
  // 支持 π 常量
  E: () => Math.E,
  // 支持 e 常量
  mod: (a, b) => a % b,
  // 模运算
  random: Math.random,
  // 支持随机数生成
  max: (a, b) => Math.max(a, b),
  // 最大值函数
  min: (a, b) => Math.min(a, b)
  // 最小值函数
};
var FUNCTION_ARITY = {
  exp: 1,
  log: 1,
  sin: 1,
  cos: 1,
  tan: 1,
  cot: 1,
  arcsin: 1,
  arccos: 1,
  arctan: 1,
  arccot: 1,
  abs: 1,
  floor: 1,
  ceil: 1,
  pow: 2,
  // pow 是一个双参数函数
  sqrt: 1,
  PI: 0,
  E: 0,
  // π 和 e 是常量函数，无参数
  mod: 2,
  // 模运算是双参数函数
  random: 0,
  // random 是无参数函数
  max: 2,
  // 最大值函数
  min: 2,
  // 最小值函数
  asin: 1,
  acos: 1,
  atan: 1,
  acot: 1,
  arctan2: 2,
  atan2: 2,
  arccot2: 2,
  acot2: 2
};
function isNumeric(token) {
  return !isNaN(parseFloat(token)) && isFinite(Number(token));
}
function isFunction(token, customFunctions) {
  return token in SUPPORTED_FUNCTIONS || customFunctions.has(token);
}
function isVariable(token, customFunctions) {
  const isIdentifier = /^[a-zA-Z_]\w*$/.test(token);
  const isArg = /^args\[\d+\]$/.test(token);
  return (isIdentifier || isArg) && !isFunction(token, customFunctions);
}
function isOperator(token) {
  return token in OPERATOR_PRECEDENCE;
}
function tokenize(expression) {
  const regex = /args\[\d+\]|[a-zA-Z_]\w*|\d+\.?\d*|[+\-*/%^(),]/g;
  const tokens = expression.match(regex);
  if (!tokens) {
    throw new Error("Cannot tokenize expression.");
  }
  return tokens;
}
function infixToRpn(tokens, slots, customFunctions) {
  const outputQueue = [];
  const operatorStack = [];
  for (const token of tokens) {
    if (isNumeric(token)) {
      outputQueue.push(parseFloat(token));
    } else if (isFunction(token, customFunctions)) {
      operatorStack.push(token);
    } else if (isVariable(token, customFunctions)) {
      const value = slots.get(token);
      if (value === void 0) {
        outputQueue.push(token);
      } else if (typeof value === "number") {
        outputQueue.push(value);
      } else {
        const numValue = parseFloat(value.toString());
        if (isNaN(numValue)) throw new Error(`Value of variable '${token}' ('${value}') is not a number.`);
        outputQueue.push(numValue);
      }
    } else if (token === ",") {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== "(") {
        outputQueue.push(operatorStack.pop());
      }
      if (operatorStack.length === 0) {
        throw new Error("Mismatched commas or parentheses in function arguments.");
      }
    } else if (isOperator(token)) {
      while (operatorStack.length > 0 && isOperator(operatorStack[operatorStack.length - 1]) && OPERATOR_PRECEDENCE[operatorStack[operatorStack.length - 1]] >= OPERATOR_PRECEDENCE[token]) {
        outputQueue.push(operatorStack.pop());
      }
      operatorStack.push(token);
    } else if (token === "(") {
      operatorStack.push(token);
    } else if (token === ")") {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== "(") {
        outputQueue.push(operatorStack.pop());
      }
      if (operatorStack.length === 0) {
        throw new Error("Mismatched parentheses.");
      }
      operatorStack.pop();
      if (operatorStack.length > 0 && isFunction(operatorStack[operatorStack.length - 1], customFunctions)) {
        outputQueue.push(operatorStack.pop());
      }
    }
  }
  while (operatorStack.length > 0) {
    const op = operatorStack.pop();
    if (op === "(") {
      throw new Error("Mismatched parentheses.");
    }
    outputQueue.push(op);
  }
  return outputQueue;
}
function evaluateRpn(rpnTokens, slots, customFunctions) {
  const stack = [];
  for (const token of rpnTokens) {
    if (typeof token === "number") {
      stack.push(token);
    } else if (isOperator(token)) {
      if (stack.length < 2) throw new Error("Invalid expression: operator needs two operands.");
      const b = stack.pop();
      const a = stack.pop();
      let result;
      switch (token) {
        case "+":
          result = a + b;
          break;
        case "-":
          result = a - b;
          break;
        case "*":
          result = a * b;
          break;
        case "/":
          if (b === 0) throw new Error("Division by zero.");
          result = a / b;
          break;
        case "%":
          if (b === 0) throw new Error("Modulo by zero.");
          result = a % b;
          break;
        case "^":
          result = Math.pow(a, b);
          break;
        default:
          throw new Error(`Unknown operator: ${token}`);
      }
      stack.push(result);
    } else if (isFunction(token, customFunctions)) {
      const funcName = token;
      if (funcName in SUPPORTED_FUNCTIONS) {
        const arity = FUNCTION_ARITY[funcName];
        const func = SUPPORTED_FUNCTIONS[funcName];
        if (stack.length < arity) throw new Error(`Function '${funcName}' needs ${arity} arguments.`);
        const args = stack.splice(stack.length - arity, arity);
        const result = func(...args);
        stack.push(result);
      } else if (customFunctions.has(funcName)) {
        const funcDef = customFunctions.get(funcName);
        const arity = funcDef.argCount;
        if (stack.length < arity) throw new Error(`Custom function '${funcName}' needs ${arity} arguments.`);
        const args = stack.splice(stack.length - arity, arity);
        const argSlots = /* @__PURE__ */ new Map();
        for (let i = 0; i < arity; i++) {
          argSlots.set(`args[${i + 1}]`, args[i]);
        }
        const executionSlots = new Map([...slots, ...argSlots]);
        const result = calculate(funcDef.expression, executionSlots, customFunctions);
        stack.push(result);
      }
    } else if (typeof token === "string" && isVariable(token, customFunctions)) {
      const value = slots.get(token);
      if (typeof value !== "number") {
        throw new Error(`Variable '${token}' not found or its value is not a number during evaluation.`);
      }
      stack.push(value);
    }
  }
  if (stack.length !== 1) {
    throw new Error("Invalid expression format.");
  }
  return stack[0];
}
function optimizeResult(value, epsilon = 1e-9) {
  if (!isFinite(value)) {
    return value;
  }
  const roundedValue = Math.round(value);
  const difference = Math.abs(value - roundedValue);
  if (difference < epsilon) {
    return roundedValue;
  }
  return value;
}
function calculate(expression, slots, functions) {
  const tokens = tokenize(expression);
  const rpn = infixToRpn(tokens, slots, functions);
  const result = evaluateRpn(rpn, slots, functions);
  return optimizeResult(result);
}

// AiGeometryBroad/src/core/HelpCommand.ts
var helpMessages = /* @__PURE__ */ new Map([
  // Meta Commands
  ["CREATE", "CREATE: \u7528\u4E8E\u521B\u5EFA\u51E0\u4F55\u5BF9\u8C61. \u540E\u9762\u5FC5\u987B\u8DDF\u4E00\u4E2A\u51E0\u4F55\u6307\u4EE4. \u793A\u4F8B: CREATE POINT name=A x=0 y=0"],
  ["CLEAR", "CLEAR: \u6E05\u7A7A\u753B\u5E03.\n- \u53EF\u9009\u53C2\u6570: color (\u6216c, \u753B\u5E03\u80CC\u666F\u8272, CSS\u989C\u8272\u503C), geoColor (\u6216g, \u540E\u7EED\u51E0\u4F55\u56FE\u5F62\u7684\u9ED8\u8BA4\u989C\u8272), labelColor (\u6216l, \u540E\u7EED\u6807\u7B7E\u7684\u9ED8\u8BA4\u989C\u8272)."],
  ["SET", 'SET: \u8BBE\u7F6E\u4E00\u4E2A\u5168\u5C40\u9ED8\u8BA4\u53C2\u6570\u3002\n- \u5FC5\u987B\u53C2\u6570: item (\u8981\u8BBE\u7F6E\u7684\u9009\u9879), value (\u8981\u8BBE\u7F6E\u7684\u503C)\u3002\n- \u53EF\u7528 item:\n  - backgroundColor: \u753B\u5E03\u80CC\u666F\u8272 (\u4F8B\u5982 "white", "#FFFFFF")\u3002\n  - penColor: \u9ED8\u8BA4\u753B\u7B14\u989C\u8272\u3002\n  - penSize: \u9ED8\u8BA4\u753B\u7B14\u7C97\u7EC6 (\u4F8B\u5982 1)\u3002\n  - labelFont: \u9ED8\u8BA4\u6807\u7B7E\u5B57\u4F53 (\u4F8B\u5982 "12px Arial")\u3002\n  - labelColor: \u9ED8\u8BA4\u6807\u7B7E\u989C\u8272\u3002\n  - labelSize: \u9ED8\u8BA4\u6807\u7B7E\u5B57\u53F7 (\u4F8B\u5982 12)\u3002\n  - pointRadius: \u9ED8\u8BA4\u70B9\u534A\u5F84\u3002\n  - pointFill: \u9ED8\u8BA4\u70B9\u662F\u5426\u586B\u5145 (true/false)\u3002\n  - drawLabelForPoints: \u521B\u5EFA\u70B9\u65F6\u662F\u5426\u9ED8\u8BA4\u7ED8\u5236\u6807\u7B7E (true/false)\u3002\n  - drawLabelForOthers: \u521B\u5EFA\u5176\u4ED6\u56FE\u5F62\u65F6\u662F\u5426\u9ED8\u8BA4\u7ED8\u5236\u6807\u7B7E (true/false)\u3002\n  - drawAfterCreate: \u521B\u5EFA\u5BF9\u8C61\u540E\u662F\u5426\u9ED8\u8BA4\u7ACB\u5373\u7ED8\u5236 (true/false)\u3002\n  - geoColor/defaultGeoColor: \u9ED8\u8BA4\u51E0\u4F55\u56FE\u5F62\u989C\u8272\u3002\n  - centerX: \u89C6\u56FE\u4E2D\u5FC3X\u5750\u6807\u3002\n  - centerY: \u89C6\u56FE\u4E2D\u5FC3Y\u5750\u6807\u3002\n  - scale: \u89C6\u56FE\u7F29\u653E\u6BD4\u4F8B\u3002\n  - lineLength: \u76F4\u7EBF/\u5C04\u7EBF\u7684\u7ED8\u5236\u957F\u5EA6 (\u4F8B\u5982 200, \u6216 {slot} \u8868\u8FBE\u5F0F; auto/0 \u8868\u793A\u6062\u590D\u9ED8\u8BA4: \u53EA\u753B\u5230\u5C4F\u5E55\u8FB9\u7F18).'],
  ["HELP", "HELP: \u663E\u793A\u5E2E\u52A9\u4FE1\u606F.\n- \u53EF\u9009\u53C2\u6570: cmd (\u8981\u67E5\u8BE2\u7684\u6307\u4EE4\u540D\u79F0)."],
  ["VIEW", "VIEW: \u8BBE\u7F6E\u89C6\u56FE\u53D8\u6362, \u5B9E\u73B0\u5E73\u79FB\u548C\u7F29\u653E.\n- \u53EF\u9009\u53C2\u6570: centerX (\u89C6\u56FE\u4E2D\u5FC3\u7684X\u5750\u6807), centerY (\u89C6\u56FE\u4E2D\u5FC3\u7684Y\u5750\u6807), scale (\u7F29\u653E\u6BD4\u4F8B)."],
  ["DRAW", "DRAW: \u7ED8\u5236\u4E00\u4E2A\u6216\u591A\u4E2A\u5DF2\u521B\u5EFA\u7684\u51E0\u4F55\u5BF9\u8C61.\n- \u5FC5\u987B\u53C2\u6570: obj (\u4E00\u4E2A\u6216\u591A\u4E2A\u5BF9\u8C61\u540D\u79F0, \u7528\u9017\u53F7\u5206\u9694).\n- \u53EF\u9009\u53C2\u6570: color(\u6216c), width, fill, style ('dashed'), label(\u6216l, \u6807\u7B7E\u6587\u672C), direction(\u6216d, \u6807\u7B7E\u4F4D\u7F6E), fontSize(\u6216fs), backgroundColor(\u6216bgc)."],
  ["FILL", "FILL: \u7ED9\u5C01\u95ED\u5BF9\u8C61\u6216\u533A\u57DF\u586B\u5145\u989C\u8272.\n- \u5FC5\u987B\u53C2\u6570: obj/region (\u533A\u57DF\u3001\u5706\u5F13\u5F62\u533A\u57DF\u3001\u66F2\u7EBF-\u5706\u533A\u57DF\u3001POLYGON\u3001TRIANGLE\u3001RECTANGLE\u3001CIRCLE \u6216 ELLIPSE \u7684\u540D\u79F0), color (\u586B\u5145\u989C\u8272).\n- \u53EF\u9009\u53C2\u6570: borderColor (\u8FB9\u754C\u7EBF\u989C\u8272), width.\n- \u793A\u4F8B: FILL obj=R color=lightblue borderColor=blue."],
  ["MEASURE", "MEASURE: \u6D4B\u91CF\u51E0\u4F55\u5C5E\u6027\u5E76\u5B58\u5165\u69FD\u4F4D.\n- \u5FC5\u987B\u53C2\u6570: type (\u6216t, \u53EF\u9009\u503C: 'distance', 'angle', 'area'), slot (\u6216s, \u7528\u4E8E\u5B58\u50A8\u7ED3\u679C\u7684\u69FD\u4F4D\u540D\u79F0).\n- \u6839\u636Etype\u4E0D\u540C, \u9700\u8981\u5176\u4ED6\u53C2\u6570:\n  - type=distance: \u9700 p1,p2 \u6216 obj (\u7EBF\u6BB5\u5BF9\u8C61).\n  - type=angle: \u9700 vertex,p1,p2 \u6216 obj1,obj2 (\u4E24\u6761\u7EBF) \u6216 obj (\u89D2\u5EA6\u5BF9\u8C61).\n  - type=area: \u9700 obj (\u591A\u8FB9\u5F62,\u5706,\u692D\u5706)."],
  ["RUN", "RUN: \u6267\u884C\u4E00\u4E2A\u5DF2\u5B9A\u4E49\u7684\u4EE3\u7801\u5757.\n- \u5FC5\u987B\u53C2\u6570: code (\u4EE3\u7801\u5757\u7684\u540D\u79F0)."],
  ["CODE", "CODE: \u5B9A\u4E49\u4E00\u4E2A\u53EF\u91CD\u590D\u4F7F\u7528\u7684\u4EE3\u7801\u5757.\n- \u5FC5\u987B\u53C2\u6570: name (\u4EE3\u7801\u5757\u7684\u540D\u79F0)."],
  ["WITHRUN", "WITHRUN: (\u6682\u672A\u5B9E\u73B0)."],
  ["CALCULATE", "CALCULATE: \u5BF9\u69FD\u4F4D\u503C\u8FDB\u884C\u6570\u5B66\u8FD0\u7B97.\n- \u5FC5\u987B\u53C2\u6570: expression (\u6216e, \u6570\u5B66\u8868\u8FBE\u5F0F, \u53EF\u7528{slot}\u5F15\u7528\u69FD\u4F4D).\n- \u53EF\u9009\u53C2\u6570: slot (\u6216s, \u7528\u4E8E\u5B58\u50A8\u7ED3\u679C\u7684\u69FD\u4F4D\u540D\u79F0)."],
  ["GETOBJ", "GETOBJ: \u83B7\u53D6\u4E00\u4E2A\u5BF9\u8C61\u7684\u5185\u90E8\u5C5E\u6027\u5E76\u5B58\u5165\u69FD\u4F4D.\n- \u5FC5\u987B\u53C2\u6570: name (\u6216n, object, o, \u5BF9\u8C61\u540D\u79F0), property (\u6216p, \u5C5E\u6027\u540D\u79F0), slot (\u6216s, \u7528\u4E8E\u5B58\u50A8\u7ED3\u679C\u7684\u69FD\u4F4D\u540D\u79F0)."],
  ["PRINT", "PRINT: \u5728\u6D88\u606F\u9762\u677F\u8F93\u51FA\u4FE1\u606F.\n- \u5FC5\u987B\u53C2\u6570: message (\u6216m, \u8981\u663E\u793A\u7684\u6D88\u606F, \u53EF\u7528{slot}\u5F15\u7528\u69FD\u4F4D)."],
  // Geometric Commands
  ["POINT", "POINT: \u521B\u5EFA\u4E00\u4E2A\u70B9.\n- \u5FC5\u987B\u53C2\u6570: name (\u70B9\u7684\u540D\u79F0), x (X\u5750\u6807), y (Y\u5750\u6807).\n- \u53EF\u9009\u53C2\u6570: radius (\u70B9\u7684\u534A\u5F84, \u9ED8\u8BA4\u4E3A1), real (\u5E03\u5C14\u503C, \u6807\u8BB0\u662F\u5426\u4E3A\u201C\u5B9E\u201D\u70B9), draw (\u5E03\u5C14\u503C)."],
  ["LINE", "LINE: \u901A\u8FC7\u4E24\u70B9\u521B\u5EFA\u4E00\u6761\u76F4\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name, p1, p2.\n- \u53EF\u9009\u53C2\u6570: draw.\n- \u7ED8\u5236\u957F\u5EA6: \u76F4\u7EBF\u7684\u7ED8\u5236\u957F\u5EA6\u7531 SET item=lineLength value=<n> \u63A7\u5236 (\u4EE5 p1\u3001p2 \u7684\u4E2D\u70B9\u4E3A\u57FA\u51C6\u5411\u4E24\u7AEF\u5404\u5EF6\u4F38\u4E00\u534A). \u672A\u8BBE\u7F6E\u65F6\u9ED8\u8BA4\u53EA\u753B\u5230\u5C4F\u5E55\u8FB9\u7F18, \u4E0D\u4F1A\u65E0\u9650\u5EF6\u4F38, \u5BFC\u51FA SVG \u4E5F\u4E0D\u4F1A\u88AB\u6491\u5927."],
  ["SEGMENT", "SEGMENT: \u901A\u8FC7\u4E24\u70B9\u521B\u5EFA\u4E00\u6761\u7EBF\u6BB5.\n- \u5FC5\u987B\u53C2\u6570: name, p1, p2.\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["RAY", "RAY: \u521B\u5EFA\u4E00\u6761\u5C04\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name, vertex (\u6216v, \u9876\u70B9), p1 (\u5C04\u7EBF\u4E0A\u53E6\u4E00\u70B9).\n- \u53EF\u9009\u53C2\u6570: draw.\n- \u7ED8\u5236\u957F\u5EA6: \u7531 SET item=lineLength value=<n> \u63A7\u5236 (\u4ECE\u9876\u70B9\u5411\u524D\u5EF6\u4F38 n). \u672A\u8BBE\u7F6E\u65F6\u9ED8\u8BA4\u53EA\u753B\u5230\u5C4F\u5E55\u8FB9\u7F18."],
  ["MIDPOINT", "MIDPOINT: \u521B\u5EFA\u4E24\u70B9\u7684\u4E2D\u70B9.\n- \u5FC5\u987B\u53C2\u6570: name, p1, p2.\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["PERPENDICULAR_FOOT", "PERPENDICULAR_FOOT: \u521B\u5EFA\u70B9\u5230\u76F4\u7EBF\u7684\u5782\u8DB3.\n- \u5FC5\u987B\u53C2\u6570: name (\u6216n, \u5782\u8DB3\u540D\u79F0), from (\u6216f, \u70B9\u540D), on (\u6216o, \u76F4\u7EBF\u540D).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["REFLECTED_POINT", "REFLECTED_POINT: \u521B\u5EFA\u4E00\u4E2A\u70B9\u7684\u5BF9\u79F0\u70B9.\n- \u5FC5\u987B\u53C2\u6570: name (\u6216n, \u65B0\u70B9\u540D\u79F0), obj (\u6216o, \u8981\u5BF9\u79F0\u7684\u70B9).\n- \u5BF9\u79F0\u65B9\u5F0F (\u4E8C\u9009\u4E00): center (\u6216c, \u4E2D\u5FC3\u5BF9\u79F0\u7684\u70B9) \u6216 axis (\u6216a, \u5BF9\u79F0\u8F74).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["ROTATED_POINT", "ROTATED_POINT: \u521B\u5EFA\u4E00\u4E2A\u70B9\u7ED5\u53E6\u4E00\u4E2D\u5FC3\u70B9\u65CB\u8F6C\u540E\u7684\u65B0\u70B9.\n- \u5FC5\u987B\u53C2\u6570: name (\u6216n, \u65B0\u70B9\u540D\u79F0), obj (\u6216o, \u8981\u65CB\u8F6C\u7684\u70B9), center (\u6216c, \u65CB\u8F6C\u4E2D\u5FC3), angle (\u6216a, \u65CB\u8F6C\u89D2\u5EA6, \u5355\u4F4D:\u5EA6).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["INTERSECT", "INTERSECT: \u521B\u5EFA\u4E24\u4E2A\u5BF9\u8C61\u7684\u4EA4\u70B9.\n- \u5FC5\u987B\u53C2\u6570: name (\u6216n, \u4EA4\u70B9\u540D\u79F0, \u591A\u4E2A\u4EA4\u70B9\u7528\u9017\u53F7\u5206\u9694), obj1(\u6216o1), obj2(\u6216o2).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["POINT_ON_LINE", "POINT_ON_LINE: \u5728\u76F4\u7EBF\u4E0A\u6CBF\u6307\u5B9A\u65B9\u5411\u548C\u8DDD\u79BB\u521B\u5EFA\u70B9.\n- \u5FC5\u987B\u53C2\u6570: name, line (\u6216l), point (\u6216p, \u8D77\u59CB\u70B9), distance (\u6216d, \u8DDD\u79BB).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["PERP_BISECTOR", "PERP_BISECTOR: \u521B\u5EFA\u4E24\u70B9\u8FDE\u7EBF\u7684\u5782\u76F4\u5E73\u5206\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name, p1, p2.\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["PERPENDICULAR", "PERPENDICULAR: \u521B\u5EFA\u7ECF\u8FC7\u6307\u5B9A\u70B9\u4E14\u5782\u76F4\u4E8E\u6307\u5B9A\u76F4\u7EBF\u7684\u5782\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name, point (\u6216p), line (\u6216l).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["PARALLEL", "PARALLEL: \u521B\u5EFA\u7ECF\u8FC7\u6307\u5B9A\u70B9\u4E14\u5E73\u884C\u4E8E\u6307\u5B9A\u76F4\u7EBF\u7684\u5E73\u884C\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name, point (\u6216p), line (\u6216l).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["ANGLE_BISECTOR", "ANGLE_BISECTOR: \u521B\u5EFA\u4E00\u4E2A\u89D2\u7684\u5E73\u5206\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name, angle (\u6216a, \u89D2\u5BF9\u8C61\u540D\u79F0).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["CIRCUMCIRCLE", "CIRCUMCIRCLE: \u521B\u5EFA\u4E09\u70B9\u7684\u5916\u63A5\u5706.\n- \u5FC5\u987B\u53C2\u6570: name, p1, p2, p3.\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["INCIRCLE", "INCIRCLE: \u521B\u5EFA\u4E09\u70B9\u7684\u5185\u5207\u5706.\n- \u5FC5\u987B\u53C2\u6570: name, p1, p2, p3.\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["TANGENT", "TANGENT: \u521B\u5EFA\u5706\u7684\u5207\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name, circle (\u6216c), point (\u6216p, \u5706\u5916\u6216\u5706\u4E0A\u7684\u70B9).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["POLYGON", "POLYGON: \u521B\u5EFA\u591A\u8FB9\u5F62.\n- \u5FC5\u987B\u53C2\u6570: name, points (\u6216p, \u9876\u70B9\u5217\u8868, \u9017\u53F7\u5206\u9694).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["REGION", "REGION: \u521B\u5EFA\u4E00\u4E2A\u53EF\u586B\u5145\u533A\u57DF.\n- \u666E\u901A\u533A\u57DF\u5FC5\u987B\u53C2\u6570: name, boundary (\u6216points/p, \u6309\u8FB9\u754C\u987A\u5E8F\u6392\u5217\u7684\u70B9\u540D, \u9017\u53F7\u5206\u9694); \u533A\u57DF\u81EA\u52A8\u95ED\u5408\u4E14\u4E0D\u5141\u8BB8\u8FB9\u754C\u81EA\u4EA4.\n- \u5706\u5F13\u5F62\u533A\u57DF: name, circle, line, side (side=left/right, \u6309 line.p1 -> line.p2 \u7684\u65B9\u5411\u5224\u65AD). line \u5FC5\u987B\u662F LINE\uFF0C\u4E14\u5FC5\u987B\u4E0E circle \u76F8\u4EA4\u4E8E\u4E24\u4E2A\u70B9.\n- \u66F2\u7EBF-\u5706\u533A\u57DF: name, curve, circle, side (side=above/below). curve \u5FC5\u987B\u662F y=f(x) \u7684 CURVE\uFF0C\u66F2\u7EBF\u8303\u56F4\u5185\u5FC5\u987B\u6070\u6709\u4E24\u4E2A\u4EA4\u70B9.\n- \u793A\u4F8B: CREATE REGION name=R boundary=A,B,C,D; CREATE REGION name=cap circle=C line=L side=left; \u6216 CREATE REGION name=R curve=P circle=C side=above; \u7136\u540E\u4F7F\u7528 FILL."],
  ["TRIANGLE", "TRIANGLE: \u521B\u5EFA\u4E09\u89D2\u5F62.\n- \u5FC5\u987B\u53C2\u6570: name, p1, p2, p3.\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["RECTANGLE", "RECTANGLE: \u521B\u5EFA\u77E9\u5F62.\n- \u5FC5\u987B\u53C2\u6570: name, p1 (\u4E00\u4E2A\u9876\u70B9), width (\u6216w), height (\u6216h).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["CIRCLE", "CIRCLE: \u521B\u5EFA\u5706.\n- \u5FC5\u987B\u53C2\u6570: name.\n- \u521B\u5EFA\u65B9\u5F0F(\u591A\u9009\u4E00):\n  1. center, radius.\n  2. center, chord (\u5F26\u5BF9\u8C61).\n  3. center, chordPt1, chordPt2.\n  4. chord, centerAngle.\n  5. chordPt1, chordPt2, centerAngle.\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["ELLIPSE", "ELLIPSE: \u521B\u5EFA\u692D\u5706.\n- \u5FC5\u987B\u53C2\u6570: name, center, radiusX, radiusY.\n- \u53EF\u9009\u53C2\u6570: rotation, draw."],
  ["PARABOLA", "PARABOLA: \u521B\u5EFA\u629B\u7269\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name.\n- \u521B\u5EFA\u65B9\u5F0F(\u4E8C\u9009\u4E00):\n  1. vertex, pValue, rotateAngle.\n  2. a, b, c (\u5BF9\u4E8E y=ax\xB2+bx+c).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["HYPERBOLA", "HYPERBOLA: \u521B\u5EFA\u53CC\u66F2\u7EBF.\n- \u5FC5\u987B\u53C2\u6570: name.\n- \u521B\u5EFA\u65B9\u5F0F(\u4E8C\u9009\u4E00):\n  1. center, aValue, bValue, rotateAngle.\n  2. f1, f2, diff (\u7126\u8DDD\u5DEE).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["ANGLE", "ANGLE: \u521B\u5EFA\u89D2.\n- \u5FC5\u987B\u53C2\u6570: name, vertex (\u6216v, \u9876\u70B9), p1 (\u89D2\u4E0A\u4E00\u70B9).\n- \u5B9A\u4E49\u65B9\u5F0F (\u4E8C\u9009\u4E00): p2 (\u89D2\u4E0A\u53E6\u4E00\u70B9) \u6216 angle (\u6216a, \u89D2\u5EA6\u503C, \u5355\u4F4D:\u5EA6).\n- \u53EF\u9009\u53C2\u6570: showArc, draw."],
  ["FOCIS", "FOCIS: \u521B\u5EFA\u692D\u5706\u3001\u53CC\u66F2\u7EBF\u6216\u629B\u7269\u7EBF\u7684\u7126\u70B9.\n- \u5FC5\u987B\u53C2\u6570: name (\u7126\u70B9\u540D\u79F0, \u591A\u4E2A\u7528\u9017\u53F7\u5206\u9694), obj (\u6216o, \u66F2\u7EBF\u5BF9\u8C61).\n- \u53EF\u9009\u53C2\u6570: draw."],
  ["RANDOMPOINT", "RANDOMPOINT: \u5728\u5BF9\u8C61\u4E0A\u521B\u5EFA\u968F\u673A\u70B9.\n- \u5FC5\u987B\u53C2\u6570: name, obj.\n- \u53EF\u9009\u53C2\u6570: start, end (\u8303\u56F4), draw."],
  ["SLOT", "SLOT: \u521B\u5EFA\u4E00\u4E2A\u53EF\u7528\u4E8E\u8BA1\u7B97\u7684\u69FD\u4F4D(\u53D8\u91CF).\n- \u5FC5\u987B\u53C2\u6570: name, value (\u6216v) \u6216 expression (\u6216e)."],
  ["FUNCTION", "FUNCTION: \u521B\u5EFA\u4E00\u4E2A\u6570\u5B66\u4E0A\u7684\u7EAF\u51FD\u6570, \u7C7B\u4F3C\u4E8ESLOT.\n- \u5FC5\u987B\u53C2\u6570: name, value (\u6216v) \u6216 expression (\u6216e) \u8868\u8FBE\u5F0F, args (\u6216a) \u53C2\u6570\u4E2A\u6570."],
  ["ANIMATION", "ANIMATION: \u521B\u5EFA\u52A8\u753B.\n- \u5FC5\u987B\u53C2\u6570: name, code (\u6267\u884C\u7684\u4EE3\u7801\u5757), slot (\u66F4\u65B0\u7684\u69FD\u4F4D).\n- \u53EF\u9009\u53C2\u6570: interval (\u6BEB\u79D2), repeat (\u5E03\u5C14\u503C), period (\u5B8C\u6574\u5468\u671F\u7684\u5E27\u6570\uFF0C\u4E3B\u8981\u7528\u4E8E\u5BFC\u51FA SVG).\n- \u4F8B\u5982: CREATE ANIMATION name=ani interval=50 repeat=true code=frame slot=slot_ani period=40\u3002period=40 \u8868\u793A\u5BFC\u51FA 40 \u5E27\u540E\u56DE\u5230\u5B8C\u6574\u5468\u671F\u3002"]
]);
var metaCommands = ["CLEAR", "SET", "HELP", "VIEW", "TRANSLATE", "DRAW", "FILL", "MEASURE", "RUN", "CODE", "WITH", "CALCULATE", "GETOBJ", "PRINT", "CREATE"];
var geometricCommands = [
  "POINT",
  "LINE",
  "SEGMENT",
  "RAY",
  "MIDPOINT",
  "PERPENDICULAR_FOOT",
  "REFLECTED_POINT",
  "ROTATED_POINT",
  "INTERSECT",
  "POINT_ON_LINE",
  "PERP_BISECTOR",
  "PERPENDICULAR",
  "PARALLEL",
  "ANGLE_BISECTOR",
  "CIRCUMCIRCLE",
  "INCIRCLE",
  "TANGENT",
  "POLYGON",
  "REGION",
  "TRIANGLE",
  "RECTANGLE",
  "CIRCLE",
  "ELLIPSE",
  "PARABOLA",
  "HYPERBOLA",
  "ANGLE",
  "FOCIS",
  "RANDOMPOINT",
  "SLOT",
  "ANIMATION"
];
function getHelpMessages(metaCommand, createCommand) {
  metaCommand = metaCommand.toUpperCase();
  createCommand = createCommand.toUpperCase();
  if (!metaCommand && !createCommand) {
    let helpText = "\u652F\u6301\u7684\u5143\u6307\u4EE4:\n";
    metaCommands.forEach((cmd) => {
      helpText += `- ${cmd}
`;
    });
    helpText += "\n\u4F7F\u7528 'HELP cmd=\u6307\u4EE4\u540D\u79F0' \u67E5\u770B\u5177\u4F53\u7528\u6CD5.";
    return helpText;
  }
  if (metaCommand === "CREATE" && !createCommand) {
    let helpText = "\u652F\u6301\u7684\u51E0\u4F55\u6307\u4EE4 (\u9700\u5728CREATE\u540E\u4F7F\u7528):\n";
    geometricCommands.forEach((cmd) => {
      helpText += `- ${cmd}
`;
    });
    helpText += "\n\u4F7F\u7528 'HELP cmd=\u6307\u4EE4\u540D\u79F0' \u67E5\u770B\u5177\u4F53\u7528\u6CD5.";
    return helpText;
  }
  if (metaCommand && metaCommand !== "CREATE") {
    return helpMessages.get(metaCommand) || `\u672A\u627E\u5230\u5143\u6307\u4EE4: ${metaCommand}`;
  }
  if ((!metaCommand || metaCommand === "CREATE") && createCommand) {
    return helpMessages.get(createCommand) || `\u672A\u627E\u5230\u51E0\u4F55\u6307\u4EE4: ${createCommand}`;
  }
  return getHelpMessages("", "");
}

// AiGeometryBroad/src/core/DSLInterpreter.ts
var GeometryDSLInterpreter = class _GeometryDSLInterpreter {
  state;
  zeroThresholdValue = 1e-6;
  constructor(canvas, onMessage) {
    this.state = {
      objects: /* @__PURE__ */ new Map(),
      codes: /* @__PURE__ */ new Map(),
      slots: /* @__PURE__ */ new Map(),
      animations: /* @__PURE__ */ new Map(),
      functions: /* @__PURE__ */ new Map(),
      lastCodeName: void 0,
      canvas,
      ctx: canvas?.getContext("2d") || void 0,
      defaultOptions: {
        canvasX: 0,
        canvasY: 0,
        width: canvas ? canvas.width : 0,
        height: canvas ? canvas.height : 0,
        geoColor: "black",
        labelColor: "white",
        centerX: 0,
        centerY: 0,
        scale: 1,
        backgroundColor: "white",
        penColor: "black",
        penSize: 1,
        labelFont: "12px Arial",
        labelSize: 12,
        pointRadius: 3,
        pointFill: true,
        drawLabelForPoints: true,
        drawLabelForOthers: false,
        drawAfterCreate: false,
        lineLength: null
      },
      onMessage,
      // Canvas 路径默认认为上下文已带变换，保持既有行为
      contextPreTransformed: true,
      renderScale: 1,
      renderOffsetX: 0,
      renderOffsetY: 0,
      animationAutoStart: true,
      variableInfo: /* @__PURE__ */ new Map(),
      frozenRandomValues: /* @__PURE__ */ new Map(),
      frozenRandomObjects: /* @__PURE__ */ new Map(),
      randomObjectSources: /* @__PURE__ */ new Map(),
      selectedObjectName: void 0
    };
  }
  addCommand(name, rawLine, command, lineNumber) {
    if (!command) {
      console.error(`Failed to parse code block at line ${lineNumber}: ${rawLine}`);
      this.state.onMessage?.("error", lineNumber, `Failed to parse code block at line ${lineNumber}: ${rawLine}`);
      return;
    }
    this.state.codes.get(name)?.push({
      type: command.type,
      command: command.command,
      params: command.params,
      rawCommand: rawLine,
      lineNumber
    });
  }
  executeLines(lines, setLineNumber) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      if (line.startsWith("[")) {
        if (!setLineNumber) {
          console.error(`Nested code blocks are not allowed at line ${i + 1}: ${line}`);
          this.state.onMessage?.("error", i + 1, `Nested code blocks are not allowed at line ${i + 1}: ${line}`);
        }
        const code = line.slice(1).trim();
        if (this.state.lastCodeName && code) {
          const command = this.parseLine(line, setLineNumber ? i + 1 : -1);
          this.addCommand(this.state.lastCodeName, line, command, i + 1);
        }
        continue;
      } else if (line.endsWith("]")) {
        this.state.lastCodeName = void 0;
        continue;
      }
      try {
        if (this.state.lastCodeName) {
          const command = this.parseLine(line, setLineNumber ? i + 1 : -1);
          this.addCommand(this.state.lastCodeName, line, command, i + 1);
        } else {
          const command = this.parseLine(line, setLineNumber ? i + 1 : -1);
          if (command) {
            this.executeCommand(command);
          }
        }
      } catch (error) {
        console.error(`Error executing line ${i + 1}: ${line}`, error);
        this.state.onMessage?.("error", i + 1, `Error executing line ${i + 1}: ${line} - ${error}`);
      }
    }
  }
  // 主要的解析和执行函数
  execute(script2) {
    this.state.codes.clear();
    this.state.animations.forEach((v, k) => {
      if (v.animationTimer > 0) {
        clearTimeout(v.animationTimer);
        v.animationTimer = 0;
      }
    });
    this.state.animations.clear();
    this.state.lastCodeName = void 0;
    this.state.objects.clear();
    this.state.slots.clear();
    this.state.functions.clear();
    this.state.variableInfo.clear();
    const lines = script2.split("\n");
    this.executeLines(lines, true);
  }
  setTransform(canvas, transform) {
    this.state.canvas = canvas;
    this.state.defaultOptions.canvasX = -transform.x / transform.scale;
    this.state.defaultOptions.canvasY = -transform.y / transform.scale;
    this.state.defaultOptions.width = canvas.width / transform.scale;
    this.state.defaultOptions.height = canvas.height / transform.scale;
  }
  // 设置视图中心的逻辑坐标（供 SVG 导出等非交互渲染使用）
  setViewCenter(centerX, centerY) {
    this.state.defaultOptions.centerX = centerX;
    this.state.defaultOptions.centerY = centerY;
  }
  // 声明渲染上下文是否已自带视图变换。
  // - Canvas 路径：上下文已经 setTransform(scale/平移)，标签坐标必须传给内部换算后再交给 canvas 二次变换。
  // - SVG 导出路径：上下文没有预置变换，标签坐标必须自己完成完整换算。
  // 不设置这个开关，两条路径至少有一条会出现标签错位。
  setContextPreTransformed(preTransformed) {
    this.state.contextPreTransformed = preTransformed;
  }
  // 设置 SVG 等无预置 Canvas 变换场景的额外渲染变换。
  // Canvas 模式保持默认值（1, 0, 0），由 ctx.setTransform 提供缩放和平移。
  setRenderTransform(transform) {
    const scale = Number.isFinite(transform.scale) && Math.abs(transform.scale) > this.zeroThresholdValue ? transform.scale : 1;
    this.state.renderScale = scale;
    this.state.renderOffsetX = Number.isFinite(transform.offsetX) ? transform.offsetX : 0;
    this.state.renderOffsetY = Number.isFinite(transform.offsetY) ? transform.offsetY : 0;
    if (this.state.ctx && !this.state.contextPreTransformed) {
      this.state.defaultOptions.canvasX = 0;
      this.state.defaultOptions.canvasY = 0;
      this.state.defaultOptions.width = this.state.canvas?.width || this.state.defaultOptions.width;
      this.state.defaultOptions.height = this.state.canvas?.height || this.state.defaultOptions.height;
    }
  }
  setSelectedObjectName(name) {
    this.state.selectedObjectName = name || void 0;
  }
  // 导出等离线场景可以关闭自动计时器，再通过 stepAnimation 逐帧采样
  setAnimationAutoStart(autoStart) {
    this.state.animationAutoStart = autoStart;
  }
  setFrozenRandomVariables(values) {
    this.state.frozenRandomValues = new Map(Object.entries(values));
  }
  setFrozenRandomObjects(values) {
    this.state.frozenRandomObjects = new Map(Object.entries(values));
  }
  getVariables() {
    const variables = Array.from(this.state.variableInfo.values()).map((variable) => ({ ...variable }));
    const objects = Array.from(this.state.objects.values()).map((object) => {
      const frozen = this.state.frozenRandomObjects.has(object.name);
      const randomSource = this.state.randomObjectSources.get(object.name);
      return {
        name: object.name,
        expression: randomSource || object.type,
        value: object.type,
        kind: "object",
        frozen,
        objectType: object.type,
        randomObject: Boolean(randomSource),
        randomSource,
        details: this.getObjectDetails(object)
      };
    });
    return [...variables, ...objects];
  }
  setRandomObjectFrozen(name, frozen) {
    const object = this.state.objects.get(name);
    const source = this.state.randomObjectSources.get(name);
    if (!object || !source || object.type !== "point") return;
    const point = object;
    if (frozen) {
      this.state.frozenRandomObjects.set(name, { x: point.x, y: point.y });
    } else {
      this.state.frozenRandomObjects.delete(name);
    }
  }
  getFrozenRandomObjects() {
    return Object.fromEntries(this.state.frozenRandomObjects.entries());
  }
  getObjectDetails(object) {
    const details = { type: object.type };
    const candidate = object;
    const format = (value) => Number(value.toFixed(6)).toString();
    const pointDetails = (prefix, point) => {
      if (point) {
        details[`${prefix}.x`] = format(point.x);
        details[`${prefix}.y`] = format(point.y);
      }
    };
    if (typeof candidate.x === "number" && typeof candidate.y === "number") {
      pointDetails("position", candidate);
      if (typeof candidate.radius === "number") details.radius = format(candidate.radius);
      if (typeof candidate.real === "boolean") details.real = String(candidate.real);
    }
    if (candidate.center) pointDetails("center", candidate.center);
    if (typeof candidate.radius === "number") details.radius = format(candidate.radius);
    if (typeof candidate.rx === "number") details.radiusX = format(candidate.rx);
    if (typeof candidate.ry === "number") details.radiusY = format(candidate.ry);
    if (typeof candidate.rotation === "number") details.rotation = format(candidate.rotation);
    if (candidate.p1) pointDetails("p1", candidate.p1);
    if (candidate.p2) pointDetails("p2", candidate.p2);
    if (candidate.vertex) pointDetails("vertex", candidate.vertex);
    if (candidate.vertices && Array.isArray(candidate.vertices)) {
      details.vertices = String(candidate.vertices.length);
    }
    if (typeof candidate.width === "number") details.width = format(candidate.width);
    if (typeof candidate.height === "number") details.height = format(candidate.height);
    return details;
  }
  setRandomVariableFrozen(name, frozen) {
    const variable = this.state.variableInfo.get(name);
    if (!variable || variable.kind !== "random") return;
    if (frozen) {
      this.state.frozenRandomValues.set(name, Number(variable.value));
    } else {
      this.state.frozenRandomValues.delete(name);
    }
    variable.frozen = frozen;
  }
  getFrozenRandomVariables() {
    return Object.fromEntries(this.state.frozenRandomValues.entries());
  }
  setRenderTarget(canvas, context) {
    this.state.canvas = canvas;
    this.state.ctx = context;
    this.state.defaultOptions.width = canvas.width;
    this.state.defaultOptions.height = canvas.height;
  }
  getAnimationDefinitions() {
    return Array.from(this.state.animations.values()).map((animation) => ({
      name: animation.name,
      code: animation.code,
      slot: animation.slot,
      interval: animation.interval,
      isRepeat: animation.isRepeat,
      period: animation.period
    }));
  }
  stepAnimation(name) {
    const animation = this.state.animations.get(name);
    if (!animation) {
      throw new Error(`Animation ${name} not found`);
    }
    this.runAnimationCode(animation);
  }
  isMetaCommand(cmd, includeCreate = false) {
    const metaCommands2 = ["CLEAR", "SET", "HELP", "VIEW", "TRANSLATE", "DRAW", "FILL", "MEASURE", "RUN", "CODE", "WITH", "CALCULATE", "GETOBJ", "PRINT", "MESSAGE"];
    if (includeCreate) {
      metaCommands2.push("CREATE");
    }
    return metaCommands2.includes(cmd.toUpperCase());
  }
  // 解析单行指令
  parseLine(line, lineNumber) {
    try {
      line = line.trim();
      if (!line) return null;
      const commentIndex = line.indexOf("#");
      if (commentIndex !== -1) {
        line = line.substring(0, commentIndex);
        line = line.trim();
        if (!line) return null;
      }
      const parts = line.split(/\s+/);
      if (parts.length === 0) return null;
      const firstPart = parts[0].toUpperCase();
      const metaCommand = this.isMetaCommand(firstPart);
      let command;
      let paramString;
      if (metaCommand) {
        command = firstPart;
        paramString = parts.slice(1).join(" ");
      } else {
        const secondPart = parts[1].toUpperCase();
        if (!secondPart) {
          return null;
        }
        command = secondPart;
        paramString = parts.slice(2).join(" ");
      }
      const params = this.parseParameters(paramString);
      return {
        type: metaCommand ? "meta" : "geometric",
        command,
        params,
        rawCommand: line,
        lineNumber
      };
    } catch (error) {
      console.error(`Failed to parse line: ${line}, at line ${lineNumber}: `, error);
      this.state.onMessage?.("error", lineNumber, `Failed to parse line: ${line}, at line ${lineNumber}: ${error}`);
      return null;
    }
  }
  // 解析参数字符串为键值对
  parseParameters(paramString) {
    const params = /* @__PURE__ */ new Map();
    const paramRegex = /(\w+)=([^=\s]+(?:\s+[^=\s]+)*?)(?=\s+\w+=|$)/g;
    let match;
    while ((match = paramRegex.exec(paramString)) !== null) {
      const key = match[1];
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      params.set(key, value);
    }
    return params;
  }
  // 执行解析后的指令
  executeCommand(command) {
    if (command.type === "meta") {
      this.executeMetaCommand(command.command.toUpperCase(), command.params, command.rawCommand, command.lineNumber);
    } else {
      this.executeGeometricCommand(command.command.toUpperCase(), command.params);
    }
  }
  // 执行元指令
  executeMetaCommand(command, params, rawCommand, lineNumber) {
    switch (command.toUpperCase()) {
      case "SET":
        this.executeSetOptions(params);
        break;
      case "HELP":
        this.executeHelp(params, lineNumber);
        break;
      case "CLEAR":
        this.executeClear(params);
        break;
      case "VIEW":
        this.executeView(params);
        break;
      case "DRAW":
        this.executeDraw(params);
        break;
      case "FILL":
        this.executeFill(params);
        break;
      case "MEASURE":
        this.executeMeasure(params);
        break;
      case "RUN":
        this.executeRunCommands(params);
        break;
      case "CODE":
        this.createCodeBlock(params);
        break;
      case "WITHRUN":
        this.executeWithRun(params);
        break;
      case "GETOBJ":
        this.executeGetObject(params);
        break;
      case "CALCULATE":
        this.executeCalculate(params);
        break;
      case "PRINT":
      case "MESSAGE":
        this.executePrint(params, rawCommand, lineNumber);
        break;
      default:
        throw new Error(`Unknown meta command: ${command}`);
    }
  }
  // 执行几何指令
  executeGeometricCommand(command, params) {
    switch (command.toUpperCase()) {
      case "POINT":
        this.createPoint(params);
        break;
      case "LINE":
        this.createLine(params);
        break;
      case "SEGMENT":
        this.createSegment(params);
        break;
      case "RAY":
        this.createRay(params);
        break;
      case "MIDPOINT":
        this.createMidpoint(params);
        break;
      case "PERPENDICULAR_FOOT":
        this.createPerpendicularFoot(params);
        break;
      case "REFLECTED_POINT":
        this.createReflectedPoint(params);
        break;
      case "ROTATED_POINT":
        this.createRotatedPoint(params);
        break;
      case "INTERSECT":
        this.createIntersection(params);
        break;
      case "ANGLEINTERSECT":
        this.createAngleIntersection(params);
        break;
      case "POINT_ON_LINE":
        this.createPointOnLine(params);
        break;
      case "PERP_BISECTOR":
        this.createPerpBisector(params);
        break;
      case "PERPENDICULAR":
        this.createPerpendicular(params);
        break;
      case "PARALLEL":
        this.createParallel(params);
        break;
      case "ANGLE_BISECTOR":
        this.createAngleBisector(params);
        break;
      case "CIRCUMCIRCLE":
        this.createCircumcircle(params);
        break;
      case "INCIRCLE":
        this.createIncircle(params);
        break;
      case "TANGENT":
        this.createTangent(params);
        break;
      case "POLYGON":
        this.createPolygon(params);
        break;
      case "REGION":
        this.createRegion(params);
        break;
      case "TRIANGLE":
        this.createTriangle(params);
        break;
      case "RECTANGLE":
        this.createRectangle(params);
        break;
      case "CIRCLE":
        this.createCircle(params);
        break;
      case "ELLIPSE":
        this.createEllipse(params);
        break;
      case "PARABOLA":
        this.createParabola(params);
        break;
      case "HYPERBOLA":
        this.createHyperbola(params);
        break;
      case "ANGLE":
        this.createAngle(params);
        break;
      case "FOCIS":
        this.createFocis(params);
        break;
      case "RANDOMPOINT":
        this.createRandomPoint(params);
        break;
      case "SLOT":
        this.createSlot(params);
        break;
      case "FUNCTION":
        this.createFunction(params);
        break;
      case "ANIMATION":
        this.createAnimation(params);
        break;
      case "CURVE":
        this.createCurve(params);
        break;
      default:
        throw new Error(`Unknown geometric command: ${command}`);
    }
  }
  // 元指令清空画板
  executeClear(params) {
    const color = this.parseColor(params, "color") || this.parseColor(params, "c") || this.state.defaultOptions.penColor;
    const geoColor = this.parseColor(params, "getColor") || this.parseColor(params, "g") || this.state.defaultOptions.geoColor;
    const labelColor = this.parseColor(params, "labelColor") || this.parseColor(params, "l") || this.state.defaultOptions.labelColor;
    if (this.state.ctx) {
      const ctx = this.state.ctx;
      const canvas = this.state.canvas;
      this.state.defaultOptions.geoColor = geoColor;
      this.state.defaultOptions.labelColor = labelColor;
      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(this.state.defaultOptions.canvasX, this.state.defaultOptions.canvasY, this.state.defaultOptions.width, this.state.defaultOptions.height);
      ctx.restore();
    }
  }
  // 设置属性
  executeSetOptions(params) {
    const item = params.get("item");
    const value = params.get("value");
    if (!item || value === void 0) {
      throw new Error('SET command requires "item" and "value" parameters.');
    }
    let isUnKnownCmd = false;
    try {
      switch (item.toLowerCase()) {
        case "backgroundcolor":
          this.state.defaultOptions.backgroundColor = value;
          break;
        case "pencolor":
          if (this.parseColor(params, value)) {
            this.state.defaultOptions.penColor = this.parseColor(params, value);
          }
          break;
        case "pensize":
          this.state.defaultOptions.penSize = parseFloat(value);
          break;
        case "labelfont":
          this.state.defaultOptions.labelFont = value;
          break;
        case "labelcolor":
          if (this.parseColor(params, value)) {
            this.state.defaultOptions.labelColor = this.parseColor(params, value);
          }
          break;
        case "labelsize":
          this.state.defaultOptions.labelSize = parseFloat(value);
          break;
        case "pointradius":
          this.state.defaultOptions.pointRadius = parseFloat(value);
          break;
        case "pointfill":
          this.state.defaultOptions.pointFill = _GeometryDSLInterpreter.parseBoolean(value);
          break;
        case "drawlabelforpoints":
          this.state.defaultOptions.drawLabelForPoints = _GeometryDSLInterpreter.parseBoolean(value);
          break;
        case "drawlabelforothers":
          this.state.defaultOptions.drawLabelForOthers = _GeometryDSLInterpreter.parseBoolean(value);
          break;
        case "drawaftercreate":
          this.state.defaultOptions.drawAfterCreate = _GeometryDSLInterpreter.parseBoolean(value);
          break;
        case "linelength":
        case "linelen":
          this.state.defaultOptions.lineLength = this.parseLineLength(params, value);
          break;
        case "geocolor":
          this.state.defaultOptions.geoColor = value;
          break;
        case "centerx":
          this.state.defaultOptions.canvasX = parseFloat(value);
          break;
        case "centery":
          this.state.defaultOptions.canvasY = parseFloat(value);
          break;
        case "scale":
          this.state.defaultOptions.scale = parseFloat(value);
          break;
        default:
          isUnKnownCmd = true;
          throw new Error(`Unknown setting item: ${item}`);
      }
    } catch (error) {
      if (isUnKnownCmd) {
        throw error;
      }
      throw new Error(`set option ${item} fail, your value ${value} is invalid`);
    }
    this.state.onMessage?.("info", 0, `Set ${item} to ${value}`);
  }
  // 解析直线/射线的绘制长度：
  // - 正数（也可以是 {slot} 表达式）：固定长度，单位与几何坐标一致
  // - auto / screen / default / none，以及 0、负数、非法值：恢复默认（只延伸到可视区域边缘）
  parseLineLength(params, value) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "auto" || normalized === "screen" || normalized === "default" || normalized === "none") {
      return null;
    }
    const parsed = this.getNumberValue(params, "value");
    if (parsed === void 0 || !Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }
  // 帮助信息
  executeHelp(params, line) {
    let message = "";
    if (params.size == 0) {
      message = getHelpMessages("", "");
    }
    const cmd = params.get("cmd") || params.get("command") || params.get("c");
    if (cmd == null) {
      message = getHelpMessages("", "");
    } else {
      if (this.isMetaCommand(cmd, true)) {
        message = getHelpMessages(cmd, "");
      } else {
        message = getHelpMessages("", cmd);
      }
    }
    if (this.state.onMessage) {
      this.state.onMessage("info", line, message);
    }
  }
  executeView(params) {
    if (params.has("centerX")) {
      const centerX = this.getNumberValue(params, "centerX");
      if (centerX === void 0) {
        throw new Error("VIEW command requires centerX parameter");
      }
      this.state.defaultOptions.centerX = centerX;
    }
    if (params.has("centerY")) {
      const centerY = this.getNumberValue(params, "centerY");
      if (centerY === void 0) {
        throw new Error("VIEW command requires centerY parameter");
      }
      this.state.defaultOptions.centerY = centerY;
    }
    if (params.has("scale")) {
      const scale = this.getNumberValue(params, "scale");
      if (scale === void 0 || isNaN(scale) || Math.abs(scale) < this.zeroThresholdValue) {
        throw new Error("VIEW command requires scale parameter");
      }
      this.state.defaultOptions.scale = scale;
    }
  }
  drawObject(ctx, params, obj, label) {
    const options = {};
    if (params.has("color")) options.color = this.parseColor(params, "color") || this.parseColor(params, "c") || this.state.defaultOptions.geoColor;
    if (params.has("width")) options.lineWidth = this.getNumberValue(params, "width") || this.getNumberValue(params, "w") || 1;
    if (params.has("fill")) options.fillColor = this.parseColor(params, "fill") || this.parseColor(params, "f") || this.state.defaultOptions.backgroundColor;
    if (params.has("style") && params.get("style") === "dashed") options.dashed = true;
    if (params.has("s") && params.get("s") === "dashed") options.dashed = true;
    if (this.state.selectedObjectName === obj.name) options.highlight = true;
    if (this.state.defaultOptions.lineLength != null) {
      options.length = this.state.defaultOptions.lineLength;
    }
    options.visibleRect = {
      x: this.state.defaultOptions.canvasX,
      y: this.state.defaultOptions.canvasY,
      width: this.state.defaultOptions.width,
      height: this.state.defaultOptions.height
    };
    const viewScale = this.state.defaultOptions.scale;
    const baseOffsetX = this.state.canvas.width / 2 - this.state.defaultOptions.centerX * viewScale;
    const baseOffsetY = this.state.canvas.height / 2 - this.state.defaultOptions.centerY * viewScale;
    const transform = {
      scale: this.state.renderScale * viewScale,
      offsetX: this.state.renderScale * baseOffsetX + this.state.renderOffsetX,
      offsetY: this.state.renderScale * baseOffsetY + this.state.renderOffsetY
    };
    obj.draw(ctx, transform, options);
    if (label != null || params.has("label") || params.has("l")) {
      const _label = label || params.get("label") || params.get("l");
      this.drawLabel(obj, _label, params, transform);
    }
  }
  executeDraw(params) {
    const objName = params.get("obj");
    if (!objName) {
      throw new Error("DRAW command requires obj parameter");
    }
    const names = objName.split(",");
    for (let name of names) {
      name = name.trim();
      const obj = this.getObject(name);
      if (!obj) {
        throw new Error(`Object ${name} not found`);
      }
      if (!this.state.ctx) {
        throw new Error("No canvas context available for drawing");
      }
      this.drawObject(this.state.ctx, params, obj, void 0);
    }
  }
  // 为一个已创建的封闭对象填充颜色。
  // FILL 的 color 表示填充色；borderColor 可选，用于控制边界线颜色。
  executeFill(params) {
    const objName = params.get("obj") || params.get("region") || params.get("o");
    if (!objName) {
      throw new Error("FILL command requires obj or region parameter");
    }
    const fillColor = this.parseColor(params, "color") || this.parseColor(params, "fill") || this.parseColor(params, "f");
    if (!fillColor) {
      throw new Error("FILL command requires color (or fill) parameter");
    }
    if (!this.state.ctx) {
      throw new Error("No canvas context available for drawing");
    }
    const borderColor = this.parseColor(params, "borderColor") || this.state.defaultOptions.geoColor;
    const drawParams = new Map(params);
    drawParams.set("obj", objName);
    drawParams.set("fill", fillColor);
    drawParams.set("color", borderColor);
    for (const rawName of objName.split(",")) {
      const name = rawName.trim();
      const obj = this.getObject(name);
      if (!obj) {
        throw new Error(`Object ${name} not found`);
      }
      if (!(obj instanceof Polygon || obj instanceof CircularRegion || obj instanceof CurveCircleRegion || obj instanceof Circle || obj instanceof Ellipse)) {
        throw new Error(`FILL only supports closed objects: region, circular-region, curve-circle-region, polygon, triangle, rectangle, circle, or ellipse. Object ${name} is ${obj.type}`);
      }
      this.drawObject(this.state.ctx, drawParams, obj, void 0);
    }
  }
  executeMeasure(params) {
    const type = params.get("type") || params.get("t") || "length";
    let value = 0;
    switch (type.toLowerCase()) {
      case "distance":
      case "length":
      case "d":
        value = this.measureDistance(params);
        break;
      case "angle":
        value = this.measureAngle(params);
        break;
      case "area":
        value = this.measureArea(params);
        break;
    }
    const slot = params.get("slot") || params.get("s");
    if (slot) {
      this.state.slots.set(slot, value);
      console.log(`Measured value for ${type} stored in slot ${slot}: ${value}`);
    }
  }
  measureDistance(params) {
    const objName = params.get("obj") || params.get("o");
    if (!objName) {
      const p1Name = params.get("p1") || params.get("point1");
      const p2Name = params.get("p2") || params.get("point2");
      if (!p1Name || !p2Name) {
        throw new Error("Distance measurement requires p1 and p2 parameters for Point objects");
      }
      const p1 = this.getObject(p1Name);
      const p2 = this.getObject(p2Name);
      if (!p1 || !p2) {
        throw new Error(`Points ${p1Name} or ${p2Name} not found`);
      }
      if (!(p1 instanceof Point) || !(p2 instanceof Point)) {
        throw new Error(`Distance measurement is only supported for Point objects`);
      }
      return p1.distanceTo(p2);
    } else {
      const obj = this.getObject(objName);
      if (!obj) {
        throw new Error(`Object ${objName} not found`);
      }
      if (!(obj instanceof Segment)) {
        throw new Error(`Distance measurement is only supported for Point objects`);
      }
      return obj.length;
    }
  }
  measureAngle(params) {
    const objName = params.get("obj") || params.get("o");
    if (objName) {
      const obj = this.getObject(objName);
      if (!obj) {
        throw new Error(`Object ${objName} not found`);
      }
      if (!(obj instanceof Angle)) {
        throw new Error(`Angle measurement via 'obj' parameter is only supported for Angle objects`);
      }
      return obj.value * 180 / Math.PI;
    }
    const vertexName = params.get("vertex") || params.get("v");
    if (vertexName) {
      const p1Name = params.get("p1");
      const p2Name = params.get("p2");
      if (p1Name == null || p2Name == null) {
        throw new Error("Angle measurement by vertex requires p1 and p2 parameters.");
      }
      const vertex = this.getObject(vertexName);
      const p1 = this.getObject(p1Name);
      const p2 = this.getObject(p2Name);
      if (!vertex || !(vertex instanceof Point) || !p1 || !(p1 instanceof Point) || !p2 || !(p2 instanceof Point)) {
        throw new Error(`Invalid points provided for angle measurement. Check if ${vertexName}, ${p1Name}, ${p2Name} are valid points.`);
      }
      const v1x = p1.x - vertex.x;
      const v1y = p1.y - vertex.y;
      const v2x = p2.x - vertex.x;
      const v2y = p2.y - vertex.y;
      const dotProduct = v1x * v2x + v1y * v2y;
      const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
      if (mag1 === 0 || mag2 === 0) {
        return 0;
      }
      let cosTheta = dotProduct / (mag1 * mag2);
      cosTheta = Math.max(-1, Math.min(1, cosTheta));
      const angleRad = Math.acos(cosTheta);
      return angleRad * (180 / Math.PI);
    }
    const line1Name = params.get("obj1") || params.get("line1") || params.get("l1");
    const line2Name = params.get("obj2") || params.get("line2") || params.get("l2");
    if (line1Name && line2Name) {
      const line1 = this.getObject(line1Name);
      const line2 = this.getObject(line2Name);
      if (!line1 || !(line1 instanceof LinearObject) || !line2 || !(line2 instanceof LinearObject)) {
        throw new Error(`Invalid lines provided for angle measurement. Check if ${line1Name} and ${line2Name} are valid lines.`);
      }
      const v1x = line1.p2.x - line1.p1.x;
      const v1y = line1.p2.y - line1.p1.y;
      const v2x = line2.p2.x - line2.p1.x;
      const v2y = line2.p2.y - line2.p1.y;
      const dotProduct = v1x * v2x + v1y * v2y;
      const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
      if (mag1 === 0 || mag2 === 0) {
        return 0;
      }
      const cosTheta = Math.abs(dotProduct) / (mag1 * mag2);
      const clampedCosTheta = Math.max(-1, Math.min(1, cosTheta));
      const angleRad = Math.acos(clampedCosTheta);
      return angleRad * (180 / Math.PI);
    }
    throw new Error("To measure an angle, provide an Angle object, or a vertex with two points, or two lines.");
  }
  measureArea(params) {
    const objName = params.get("obj");
    if (!objName) {
      throw new Error("MEASURE AREA command requires obj parameter");
    }
    const obj = this.getObject(objName);
    if (obj instanceof Polygon) {
      return obj.area;
    }
    if (obj instanceof Circle) {
      return Math.PI * obj.radius * obj.radius;
    }
    if (obj instanceof Ellipse) {
      return Math.PI * obj.rx * obj.ry;
    }
    throw new Error(`Area measurement is only supported for Polygon and Circle objects`);
  }
  // 执行一段指令
  executeRunCommands(params) {
    const codeName = params.get("code");
    if (!codeName) {
      throw new Error("RUN command requires code parameter");
    }
    const commands = this.state.codes.get(codeName);
    if (!commands) {
      throw new Error(`Code ${codeName} not found`);
    }
    this.executeLines(commands.map((x) => x.rawCommand), false);
  }
  // 创建代码块
  createCodeBlock(params) {
    const blockName = params.get("name");
    if (!blockName) {
      throw new Error("BLOCK command requires name parameter");
    }
    this.state.lastCodeName = blockName;
    this.state.codes.set(blockName, []);
    console.log(`Created code block: ${blockName}`);
  }
  // 执行WITHRUN指令
  executeWithRun(params) {
    const codeName = params.get("code") || params.get("c");
    const withSlot = params.get("with") || params.get("w");
    if (!codeName || !withSlot) {
      throw new Error("WITH command requires code parameter");
    }
    const commands = this.state.codes.get(codeName);
    if (!commands) {
      throw new Error(`Code ${codeName} not found`);
    }
    const withValue = this.getNumberValue(params, "with") || this.getNumberValue(params, "w");
    if (withValue === void 0 || isNaN(withValue) || Math.abs(withValue) < this.zeroThresholdValue) {
      return;
    }
    this.executeLines(commands.map((x) => x.rawCommand), false);
  }
  /**
   * 从一个目标中获取对象获取某个属性，获取到该对象以后，将其name放入到slot中
   * @param params 
   */
  executeGetObject(params) {
    const objName = params.get("name") || params.get("n") || params.get("object") || params.get("o");
    if (!objName) {
      throw new Error("GETOBJ command requires name parameter");
    }
    const propertyName = params.get("property") || params.get("p");
    if (!propertyName) {
      throw new Error("GETOBJ command requires property parameter");
    }
    const slotName = params.get("slot") || params.get("s");
    if (!slotName) {
      throw new Error("GETOBJ command requires slot parameter");
    }
    const obj = this.getObject(objName);
    if (!obj) {
      throw new Error(`Object ${objName} not found`);
    }
    if (!(propertyName in obj)) {
      throw new Error(`Property ${propertyName} does not exist on object ${objName}`);
    }
    const value = obj[propertyName];
    if (value instanceof GeometricObject) {
      const valueName = value.name;
      this.state.slots.set(slotName, valueName);
      console.log(`Retrieved object: ${objName}`, obj);
    } else {
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        this.state.slots.set(slotName, value);
      }
    }
  }
  // 执行计算指令
  executeCalculate(params) {
    const expression = params.get("expression") || params.get("e");
    if (!expression) {
      throw new Error("CALCULATE command requires expression parameter");
    }
    const result = this.executeSlotExpression(expression);
    const slotName = params.get("slot") || params.get("s");
    if (slotName) {
      this.state.slots.set(slotName, result);
    }
  }
  /**
   * 提取字符串中的所有嵌套表达式，表达式以 { 和 } 包围，支持多层嵌套。
   * 如果遇到不完整的平衡组，左边的 '{' 会被当作普通字符处理。
   *
   * @param {string} text 需要解析的原始字符串。
   * @returns {string[]} 包含所有提取出的完整表达式的字符串数组。
   */
  extractExpressions(text) {
    const expressions = [];
    const stack = [];
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === "{") {
        if (stack.length === 0) {
          start = i;
        }
        stack.push(i);
      } else if (char === "}") {
        if (stack.length > 0) {
          const openIndex = stack.pop();
          if (stack.length === 0) {
            expressions.push(text.substring(start, i + 1));
            start = -1;
          }
        } else {
        }
      }
    }
    return expressions;
  }
  executePrint(params, rawCommand, lineNumber) {
    const reg = /\b(message|m)=(.*)/i;
    const messageMatch = reg.exec(rawCommand);
    if (!messageMatch) {
      return;
    }
    let message = messageMatch[2];
    const expressMatchs = this.extractExpressions(message);
    if (expressMatchs.length > 0) {
      expressMatchs.forEach((slot) => {
        const slotName = slot.slice(1, -1);
        const slotValue = this.executeSlotExpression(slotName);
        if (slotValue !== void 0) {
          message = message.replace(slot, slotValue.toString());
        } else {
          console.warn(`Slot ${slotName} not found in message at line ${lineNumber}`);
        }
      });
    }
    console.log(`Print at line ${lineNumber}: ${message}`);
    this.state.onMessage?.("info", lineNumber, message);
  }
  static parseBoolean(value) {
    if (value === void 0) return false;
    return value.toLowerCase() === "true";
  }
  executeSlotExpression(expression) {
    expression = expression.replace(/(^|\()\s*-\s*/g, "$10 - ");
    return calculate(expression, this.state.slots, this.state.functions);
  }
  getNumberValue(params, key) {
    const value = params.get(key);
    if (value === void 0) {
      return void 0;
    }
    if (value.startsWith("{") && value.endsWith("}")) {
      const slotExpression = value.slice(1, -1);
      const slotValue = this.executeSlotExpression(slotExpression);
      return slotValue;
    }
    const num = parseFloat(value);
    if (isNaN(num)) {
      return void 0;
    }
    return num;
  }
  // 几何指令实现示例（需要根据实际的几何对象类来实现）
  createPoint(params) {
    const name = params.get("name");
    const x = this.getNumberValue(params, "x") || 0;
    const y = this.getNumberValue(params, "y") || 0;
    const radius = this.getNumberValue(params, "radius") || 1;
    const real = _GeometryDSLInterpreter.parseBoolean(params.get("real"));
    if (!name) {
      throw new Error("POINT command requires name parameter");
    }
    const point = new Point(name, x, y, radius, real);
    this.state.objects.set(name, point);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, point, name);
    }
  }
  createLine(params) {
    const name = params.get("name");
    const p1Name = params.get("p1");
    const p2Name = params.get("p2");
    if (!name || !p1Name || !p2Name) {
      throw new Error("LINE command requires name, p1, and p2 parameters");
    }
    const p1 = this.getObject(p1Name);
    const p2 = this.getObject(p2Name);
    if (!p1 || !p2) {
      throw new Error(`Points ${p1Name} or ${p2Name} not found`);
    }
    const line = new Line(name, p1, p2);
    this.state.objects.set(name, line);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, line, void 0);
    }
  }
  createSegment(params) {
    const name = params.get("name");
    const p1Name = params.get("p1");
    const p2Name = params.get("p2");
    if (!name || !p1Name || !p2Name) {
      throw new Error("SEGMENT command requires name, p1, and p2 parameters");
    }
    const p1 = this.getObject(p1Name);
    const p2 = this.getObject(p2Name);
    if (!p1 || !p2) {
      throw new Error(`Points ${p1Name} or ${p2Name} not found`);
    }
    const segment = new Segment(name, p1, p2);
    this.state.objects.set(name, segment);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, segment, void 0);
    }
  }
  // 创建射线
  createRay(params) {
    const name = params.get("name");
    const vertexName = params.get("vertex") || params.get("v");
    const p1Name = params.get("p1");
    if (!name || !vertexName || !p1Name) {
      throw new Error("RAY command requires name, vertex, and p1 parameters");
    }
    const vertex = this.getObject(vertexName);
    const p1 = this.getObject(p1Name);
    if (!vertex || !p1) {
      throw new Error(`Points ${vertexName} or ${p1Name} not found`);
    }
    const ray = new Ray(name, vertex, p1);
    this.state.objects.set(name, ray);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, ray, void 0);
    }
  }
  createMidpoint(params) {
    const name = params.get("name") || params.get("n");
    const p1Name = params.get("p1");
    const p2Name = params.get("p2");
    if (!name || !p1Name || !p2Name) {
      throw new Error("MIDPOINT command requires name, p1, and p2 parameters");
    }
    const p1Raw = this.getObject(p1Name);
    const p2Raw = this.getObject(p2Name);
    if (!p1Raw || !p2Raw) {
      throw new Error(`Points ${p1Name} or ${p2Name} not found`);
    }
    const p1 = p1Raw;
    const p2 = p2Raw;
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const midpoint = new Point(name, midX, midY);
    this.state.objects.set(name, midpoint);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, midpoint, name);
    }
  }
  createPerpendicularFoot(params) {
    const name = params.get("name") || params.get("n");
    const pointName = params.get("point") || params.get("p");
    const lineName = params.get("obj") || params.get("o") || params.get("line");
    if (!name || !pointName || !lineName) {
      throw new Error("PerpendicularFoot need name, point and line");
    }
    const point = this.getObject(pointName);
    const line = this.getObject(lineName);
    if (!point || !(point instanceof Point)) {
      throw new Error(`invalid point name : ${pointName}`);
    }
    if (!line || !(line instanceof LinearObject)) {
      throw new Error(`invalid line name : ${lineName}`);
    }
    const vx = line.p2.x - line.p1.x;
    const vy = line.p2.y - line.p1.y;
    const wx = point.x - line.p1.x;
    const wy = point.y - line.p1.y;
    const dotProduct = wx * vx + wy * vy;
    const lenSq = vx * vx + vy * vy;
    const t = lenSq === 0 ? 0 : dotProduct / lenSq;
    const footX = line.p1.x + t * vx;
    const footY = line.p1.y + t * vy;
    const footPoint = new Point(name, footX, footY);
    this.state.objects.set(name, footPoint);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, footPoint, name);
    }
  }
  createReflectedPoint(params) {
    const name = params.get("name") || params.get("n");
    const objName = params.get("obj") || params.get("o");
    if (!name || !objName) {
      throw new Error('ReflectedPoint requires a "name" and an "obj" to reflect.');
    }
    const objToReflect = this.getObject(objName);
    if (!objToReflect || !(objToReflect instanceof Point)) {
      throw new Error(`Object to reflect must be a valid point: ${objName}`);
    }
    const centerName = params.get("center") || params.get("c");
    const axisName = params.get("axis") || params.get("a");
    if (centerName) {
      const centerPoint = this.getObject(centerName);
      if (!centerPoint || !(centerPoint instanceof Point)) {
        throw new Error(`Center of reflection must be a valid point: ${centerName}`);
      }
      const reflectedX = 2 * centerPoint.x - objToReflect.x;
      const reflectedY = 2 * centerPoint.y - objToReflect.y;
      const reflectedPoint = new Point(name, reflectedX, reflectedY);
      this.state.objects.set(name, reflectedPoint);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, reflectedPoint, name);
      }
    } else if (axisName) {
      const axisLine = this.getObject(axisName);
      if (!axisLine || !(axisLine instanceof LinearObject)) {
        throw new Error(`Axis of reflection must be a valid line: ${axisName}`);
      }
      const vx = axisLine.p2.x - axisLine.p1.x;
      const vy = axisLine.p2.y - axisLine.p1.y;
      const wx = objToReflect.x - axisLine.p1.x;
      const wy = objToReflect.y - axisLine.p1.y;
      const dotProduct = wx * vx + wy * vy;
      const lenSq = vx * vx + vy * vy;
      const t = lenSq === 0 ? 0 : dotProduct / lenSq;
      const footX = axisLine.p1.x + t * vx;
      const footY = axisLine.p1.y + t * vy;
      const reflectedX = 2 * footX - objToReflect.x;
      const reflectedY = 2 * footY - objToReflect.y;
      const reflectedPoint = new Point(name, reflectedX, reflectedY);
      this.state.objects.set(name, reflectedPoint);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, reflectedPoint, name);
      }
    } else {
      throw new Error('ReflectedPoint requires either a "center" point or an "axis" line parameter.');
    }
  }
  createRotatedPoint(params) {
    const name = params.get("name") || params.get("n");
    const objName = params.get("obj") || params.get("o");
    const centerName = params.get("center") || params.get("c");
    const angleStr = params.get("angle") || params.get("a");
    if (!name || !objName || !centerName || !angleStr) {
      throw new Error('RotatedPoint requires a "name", "obj", "center", and "angle".');
    }
    const objToRotate = this.getObject(objName);
    if (!objToRotate || !(objToRotate instanceof Point)) {
      throw new Error(`Object to rotate must be a valid point: ${objName}`);
    }
    const centerPoint = this.getObject(centerName);
    if (!centerPoint || !(centerPoint instanceof Point)) {
      throw new Error(`Center of rotation must be a valid point: ${centerName}`);
    }
    const angleInDegrees = this.getNumberValue(params, "angle") || this.getNumberValue(params, "a");
    if (angleInDegrees == null || isNaN(angleInDegrees)) {
      throw new Error(`Invalid angle value: ${angleStr}`);
    }
    const angleInRadians = angleInDegrees * (Math.PI / 180);
    const translatedX = objToRotate.x - centerPoint.x;
    const translatedY = objToRotate.y - centerPoint.y;
    const rotatedX_temp = translatedX * Math.cos(angleInRadians) - translatedY * Math.sin(angleInRadians);
    const rotatedY_temp = translatedX * Math.sin(angleInRadians) + translatedY * Math.cos(angleInRadians);
    const finalX = rotatedX_temp + centerPoint.x;
    const finalY = rotatedY_temp + centerPoint.y;
    const rotatedPoint = new Point(name, finalX, finalY);
    this.state.objects.set(name, rotatedPoint);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, rotatedPoint, name);
    }
  }
  TwoLinesIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name) {
    const intersection = obj1Raw.IntersectionWithLine(obj2Raw);
    if (!intersection) {
      throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
    }
    const intersectionPoint = new Point(name, intersection.x, intersection.y);
    this.state.objects.set(name, intersectionPoint);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, intersectionPoint, name);
    }
  }
  TwoCirclesIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name) {
    const intersectionPoints = obj1Raw.getPointAtDistanceFromTarget(obj2Raw.center, obj2Raw.radius);
    if (intersectionPoints.length === 0) {
      throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
    }
    const names = name.split(",");
    if (intersectionPoints.length == 1) {
      const intersectionPoint = new Point(names[0], intersectionPoints[0].x, intersectionPoints[0].y);
      this.state.objects.set(intersectionPoint.name, intersectionPoint);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, intersectionPoint, name);
      }
      return;
    }
    if (intersectionPoints.length == 2) {
      const findPoint0 = this.findPoint(intersectionPoints[0].x, intersectionPoints[0].y);
      const findPoint1 = this.findPoint(intersectionPoints[1].x, intersectionPoints[1].y);
      if (findPoint0 && findPoint1) {
        return;
      }
      if (findPoint0) {
        const intersectionPoint = new Point(names[0], intersectionPoints[1].x, intersectionPoints[1].y);
        this.state.objects.set(intersectionPoint.name, intersectionPoint);
        const draw2 = params.get("draw");
        if (draw2 != null && draw2 == "true" && this.state.ctx) {
          this.drawObject(this.state.ctx, params, intersectionPoint, name);
        }
        return;
      }
      if (findPoint1) {
        const intersectionPoint = new Point(names[0], intersectionPoints[0].x, intersectionPoints[0].y);
        this.state.objects.set(intersectionPoint.name, intersectionPoint);
        const draw2 = params.get("draw");
        if (draw2 != null && draw2 == "true" && this.state.ctx) {
          this.drawObject(this.state.ctx, params, intersectionPoint, name);
        }
        return;
      }
      const intersectionPoint1 = new Point(names[0], intersectionPoints[0].x, intersectionPoints[0].y);
      const intersectionPoint2 = new Point(names[1], intersectionPoints[1].x, intersectionPoints[1].y);
      this.state.objects.set(intersectionPoint1.name, intersectionPoint1);
      this.state.objects.set(intersectionPoint2.name, intersectionPoint2);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, intersectionPoint1, intersectionPoint1.name);
        this.drawObject(this.state.ctx, params, intersectionPoint2, intersectionPoint2.name);
      }
      return;
    }
  }
  LineAndCircleIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name) {
    const points = obj2Raw.getIntersectionWithLine(obj1Raw);
    if (points.length === 0) {
      throw new Error(`No intersection found between ${obj1Name} and ${obj2Name}`);
    }
    const names = name.split(",");
    if (points.length === 1) {
      const intersectionPoint = new Point(names[0], points[0].x, points[0].y);
      this.state.objects.set(intersectionPoint.name, intersectionPoint);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, intersectionPoint, name);
      }
      return;
    }
    if (points.length === 2) {
      const findPoint0 = this.findPoint(points[0].x, points[0].y);
      const findPoint1 = this.findPoint(points[1].x, points[1].y);
      if (findPoint0 && findPoint1) {
        return;
      }
      if (findPoint0) {
        const draw2 = params.get("draw");
        if (findPoint0.name != names[0]) {
          const intersectionPoint3 = new Point(names[0], points[1].x, points[1].y);
          this.state.objects.set(intersectionPoint3.name, intersectionPoint3);
          if (draw2 != null && draw2 == "true" && this.state.ctx) {
            this.drawObject(this.state.ctx, params, intersectionPoint3, names[0]);
          }
        }
        const intersectionPoint = new Point(names[1], points[1].x, points[1].y);
        this.state.objects.set(intersectionPoint.name, intersectionPoint);
        if (draw2 != null && draw2 == "true" && this.state.ctx) {
          this.drawObject(this.state.ctx, params, intersectionPoint, name[1]);
        }
        return;
      }
      if (findPoint1) {
        const draw2 = params.get("draw");
        if (findPoint1.name != names[1]) {
          const intersectionPoint3 = new Point(names[1], points[0].x, points[0].y);
          this.state.objects.set(intersectionPoint3.name, intersectionPoint3);
          if (draw2 != null && draw2 == "true" && this.state.ctx) {
            this.drawObject(this.state.ctx, params, intersectionPoint3, names[1]);
          }
        }
        const intersectionPoint = new Point(names[0], points[0].x, points[0].y);
        this.state.objects.set(intersectionPoint.name, intersectionPoint);
        if (draw2 != null && draw2 == "true" && this.state.ctx) {
          this.drawObject(this.state.ctx, params, intersectionPoint, name[0]);
        }
        return;
      }
      const intersectionPoint1 = new Point(names[0], points[0].x, points[0].y);
      const intersectionPoint2 = new Point(names[1], points[1].x, points[1].y);
      this.state.objects.set(intersectionPoint1.name, intersectionPoint1);
      this.state.objects.set(intersectionPoint2.name, intersectionPoint2);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, intersectionPoint1, intersectionPoint1.name);
        this.drawObject(this.state.ctx, params, intersectionPoint2, intersectionPoint2.name);
      }
    }
  }
  createIntersection(params) {
    const name = params.get("name");
    const obj1Name = params.get("obj1") || params.get("o1");
    const obj2Name = params.get("obj2") || params.get("o2");
    if (!name || !obj1Name || !obj2Name) {
      throw new Error("INTERSECT command requires name, obj1, and obj2 parameters");
    }
    const obj1Raw = this.getObject(obj1Name);
    const obj2Raw = this.getObject(obj2Name);
    if (!obj1Raw || !obj2Raw) {
      throw new Error(`Objects ${obj1Name} or ${obj2Name} not found`);
    }
    if (obj1Raw instanceof LinearObject && obj2Raw instanceof LinearObject) {
      return this.TwoLinesIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
    }
    if (obj1Raw instanceof Circle && obj2Raw instanceof Circle) {
      return this.TwoCirclesIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
    }
    if (obj1Raw instanceof LinearObject && obj2Raw instanceof Circle) {
      return this.LineAndCircleIntersection(params, obj1Raw, obj2Raw, name, obj1Name, obj2Name);
    }
    if (obj1Raw instanceof Circle && obj2Raw instanceof LinearObject) {
      return this.LineAndCircleIntersection(params, obj2Raw, obj1Raw, name, obj2Name, obj1Name);
    }
    if (obj1Raw instanceof Angle && obj2Raw instanceof LinearObject) {
      return this.TwoLinesIntersection(params, obj1Raw.line2, obj2Raw, name, obj1Name, obj2Name);
    }
    if (obj1Raw instanceof LinearObject && obj2Raw instanceof Angle) {
      return this.TwoLinesIntersection(params, obj1Raw, obj2Raw.line2, name, obj1Name, obj2Name);
    }
    if (obj1Raw instanceof Angle && obj2Raw instanceof Circle) {
      return this.LineAndCircleIntersection(params, obj1Raw.line2, obj2Raw, name, obj1Name, obj2Name);
    }
    if (obj1Raw instanceof Circle && obj2Raw instanceof Angle) {
      return this.LineAndCircleIntersection(params, obj2Raw.line2, obj1Raw, name, obj1Name, obj2Name);
    }
    if (obj1Raw instanceof Angle && obj2Raw instanceof Angle) {
      return this.TwoLinesIntersection(params, obj1Raw.line2, obj2Raw.line2, name, obj1Name, obj2Name);
    }
  }
  createAngleIntersection(params) {
  }
  createPointOnLine(params) {
    const name = params.get("name");
    const lineName = params.get("line");
    const distance = this.getNumberValue(params, "distance") || this.getNumberValue(params, "d") || 0;
    const pointName = params.get("point") || params.get("p");
    if (!name || !lineName || !pointName || isNaN(distance)) {
      throw new Error("POINT_ON_LINE command requires name, line, and point parameters");
    }
    const lineRaw = this.getObject(lineName);
    const pointRaw = this.getObject(pointName);
    if (!lineRaw || !pointRaw) {
      throw new Error(`Line ${lineName} or point ${pointName} not found`);
    }
    if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
      throw new Error(`Object ${lineName} is not a valid linear object`);
    }
    const line = lineRaw;
    const point = pointRaw;
    const newPointPos = line.pointAtDistance(point, distance);
    const newPoint = new Point(name, newPointPos.x, newPointPos.y);
    this.state.objects.set(name, newPoint);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, newPoint, name);
    }
  }
  createPerpBisector(params) {
    const name = params.get("name");
    const p1Name = params.get("p1");
    const p2Name = params.get("p2");
    if (!name || !p1Name || !p2Name) {
      throw new Error("PERP_BISECTOR command requires name, p1, and p2 parameters");
    }
    const p1Raw = this.getObject(p1Name);
    const p2Raw = this.getObject(p2Name);
    if (!p1Raw || !p2Raw) {
      throw new Error(`Points ${p1Name} or ${p2Name} not found`);
    }
    const p1 = p1Raw;
    const p2 = p2Raw;
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const midpoint = new Point(name + "_<mid>", midX, midY);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    let newPoint;
    if (dx === 0) {
      newPoint = new Point(name + "_<dir>", midX + 1, midY);
    } else if (dy === 0) {
      newPoint = new Point(name + "_<dir>", midX, midY + 1);
    } else {
      let slope = -dx / dy;
      newPoint = new Point(name + "_<dir>", midX + 1, midY + slope);
    }
    this.state.objects.set(midpoint.name, midpoint);
    this.state.objects.set(newPoint.name, newPoint);
    const perpBisector = new Line(name, midpoint, newPoint);
    this.state.objects.set(name, perpBisector);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, perpBisector, void 0);
    }
  }
  createPerpendicular(params) {
    const name = params.get("name");
    const lineName = params.get("line");
    const pointName = params.get("point") || params.get("p");
    if (!name || !lineName || !pointName) {
      throw new Error("PERPENDICULAR command requires name, line, and point parameters");
    }
    const lineRaw = this.getObject(lineName);
    const pointRaw = this.getObject(pointName);
    if (!lineRaw || !pointRaw) {
      throw new Error(`Line ${lineName} or point ${pointName} not found`);
    }
    if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
      throw new Error(`Object ${lineName} is not a valid linear object`);
    }
    const line = lineRaw;
    const point = pointRaw;
    const perpPointPos = line.perpendicularLineThroughPoint(point);
    const perpPoint = new Point(name + "_<pend>", perpPointPos.x, perpPointPos.y);
    this.state.objects.set(perpPoint.name, perpPoint);
    const perpendicularLine = new Line(name, point, perpPoint);
    this.state.objects.set(name, perpendicularLine);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, perpendicularLine, void 0);
    }
  }
  createParallel(params) {
    const name = params.get("name");
    const lineName = params.get("line");
    const pointName = params.get("point") || params.get("p");
    if (!name || !lineName || !pointName) {
      throw new Error("PARALLEL command requires name, line, and point parameters");
    }
    const lineRaw = this.getObject(lineName);
    const pointRaw = this.getObject(pointName);
    if (!lineRaw || !pointRaw) {
      throw new Error(`Line ${lineName} or point ${pointName} not found`);
    }
    if (!(lineRaw instanceof Line || lineRaw instanceof Segment || lineRaw instanceof Ray)) {
      throw new Error(`Object ${lineName} is not a valid linear object`);
    }
    const line = lineRaw;
    const point = pointRaw;
    const parallelPointPos = line.parallelLineThroughPoint(point);
    const parallelPoint = new Point(name + "_<para>", parallelPointPos.x, parallelPointPos.y);
    this.state.objects.set(parallelPoint.name, parallelPoint);
    const parallelLine = new Line(name, point, parallelPoint);
    this.state.objects.set(name, parallelLine);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, parallelLine, void 0);
    }
  }
  createAngleBisector(params) {
    const name = params.get("name");
    const angleName = params.get("angle") || params.get("a");
    if (!name || !angleName) {
      throw new Error("ANGLE_BISECTOR command requires name and angle parameters");
    }
    const angleRaw = this.getObject(angleName);
    if (!angleRaw || !(angleRaw instanceof Angle)) {
      throw new Error(`Angle ${angleName} not found or is not a valid angle object`);
    }
    const angle = angleRaw;
    const bisectorPointPos = angle.getRotatedPoint1(angle.degreesValue / 2);
    const bisectorPoint = new Point(name + "_<bisector>", bisectorPointPos.x, bisectorPointPos.y);
    this.state.objects.set(bisectorPoint.name, bisectorPoint);
    const bisectorLine = new Line(name, angle.vertex, bisectorPoint);
    this.state.objects.set(name, bisectorLine);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, bisectorLine, void 0);
    }
  }
  createCircumcircle(params) {
    const name = params.get("name");
    const p1Name = params.get("p1");
    const p2Name = params.get("p2");
    const p3Name = params.get("p3");
    if (!name || !p1Name || !p2Name || !p3Name) {
      throw new Error("CIRCUMCIRCLE command requires name, p1, p2, and p3 parameters");
    }
    const p1 = this.getObject(p1Name);
    const p2 = this.getObject(p2Name);
    const p3 = this.getObject(p3Name);
    if (!p1 || !p2 || !p3) {
      throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
    }
    const circumcircle = Circle.fromCircumcircle(p1, p2, p3);
    const center = new Point(name + "_<cumcenter>", circumcircle.pt.x, circumcircle.pt.y);
    this.state.objects.set(center.name, center);
    const circle = Circle.fromRadius(name, center, circumcircle.radius);
    this.state.objects.set(name, circle);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, circle, void 0);
    }
  }
  createIncircle(params) {
    const name = params.get("name");
    const p1Name = params.get("p1");
    const p2Name = params.get("p2");
    const p3Name = params.get("p3");
    if (!name || !p1Name || !p2Name || !p3Name) {
      throw new Error("CIRCUMCIRCLE command requires name, p1, p2, and p3 parameters");
    }
    const p1 = this.getObject(p1Name);
    const p2 = this.getObject(p2Name);
    const p3 = this.getObject(p3Name);
    if (!p1 || !p2 || !p3) {
      throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
    }
    const incircle = Circle.fromIncircle(p1, p2, p3);
    const center = new Point(name + "_<inccenter>", incircle.pt.x, incircle.pt.y);
    this.state.objects.set(center.name, center);
    const circle = Circle.fromRadius(name, center, incircle.radius);
    this.state.objects.set(name, circle);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, circle, void 0);
    }
  }
  createTangent(params) {
    const name = params.get("name");
    const circleName = params.get("circle") || params.get("c");
    const pointName = params.get("point") || params.get("p");
    if (!name || !circleName || !pointName) {
      throw new Error("TANGENT command requires name, circle, and point parameters");
    }
    const circleRaw = this.getObject(circleName);
    const pointRaw = this.getObject(pointName);
    if (!circleRaw || !pointRaw) {
      throw new Error(`Circle ${circleName} or point ${pointName} not found`);
    }
    if (!(circleRaw instanceof Circle)) {
      throw new Error(`Object ${circleName} is not a valid circle object`);
    }
    const circle = circleRaw;
    const point = pointRaw;
    const splitName = name.split(",");
    const distance = circle.center.distanceTo(point);
    if (Math.abs(distance - circle.radius) <= this.zeroThresholdValue) {
      const segmentRadius = new Segment(splitName[0] + "_<circle_radius>", point, circle.center);
      this.state.objects.set(segmentRadius.name, segmentRadius);
      const perpPointPos = segmentRadius.perpendicularLineThroughPoint(point);
      const perpPoint = new Point(splitName[0] + "_<circle_Point>", perpPointPos.x, perpPointPos.y);
      this.state.objects.set(perpPoint.name, perpPoint);
      const segment = new Segment(splitName[0], point, perpPoint);
      this.state.objects.set(name, segment);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, segment, void 0);
      }
    } else {
      if (distance < circle.radius) {
        throw new Error(`Point ${pointName} is inside the circle ${circleName}, cannot create tangent`);
      }
      const tangentLength = Math.sqrt(distance * distance - circle.radius * circle.radius);
      const tangentPointPos = circle.getPointAtDistanceFromTarget(point, tangentLength);
      if (tangentPointPos.length !== 2) {
        throw new Error(`Failed to calculate tangent point for ${pointName} on circle ${circleName}`);
      }
      const tangentPoint1 = new Point(splitName[0], tangentPointPos[0].x, tangentPointPos[0].y);
      const tangentPoint2 = new Point(splitName[1] || splitName[0] + "_<next_tangent_point>", tangentPointPos[1].x, tangentPointPos[1].y);
      this.state.objects.set(tangentPoint1.name, tangentPoint1);
      this.state.objects.set(tangentPoint2.name, tangentPoint2);
      const segment1 = new Segment(splitName[0], point, tangentPoint1);
      this.state.objects.set(segment1.name, segment1);
      const segment2 = new Segment(splitName[1], point, tangentPoint1);
      this.state.objects.set(segment2.name, segment2);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, segment1, void 0);
        this.drawObject(this.state.ctx, params, segment2, void 0);
      }
    }
  }
  createPolygon(params) {
    const name = params.get("name");
    const pointsParam = params.get("points") || params.get("p");
    if (!name || !pointsParam) {
      throw new Error("POLYGON command requires name and points parameters");
    }
    const pointsNames = pointsParam.split(",");
    const points = [];
    for (const pointName of pointsNames) {
      const point = this.getObject(pointName.trim());
      if (!point || !(point instanceof Point)) {
        throw new Error(`Point ${pointName} not found or is not a valid point object`);
      }
      points.push(point);
    }
    if (points.length < 3) {
      throw new Error("POLYGON command requires at least 3 points");
    }
    const polygon = new Polygon(name, points);
    this.state.objects.set(name, polygon);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, polygon, void 0);
    }
  }
  /**
   * 创建一个由有序点边界围成的可填充区域。
   *
   * 算法约定：boundary/points 中的点按边界行走顺序提供，最后一个点会
   * 自动与第一个点闭合；因此每条边都是确定的直线段，区域描述不会依赖
   * Canvas 当前缩放或像素采样。
   */
  createRegion(params) {
    const name = params.get("name");
    if (!name) {
      throw new Error("REGION command requires name parameter");
    }
    const circleName = params.get("circle") || params.get("c");
    const lineName = params.get("line") || params.get("l");
    const curveName = params.get("curve") || params.get("curve1");
    if (curveName || params.has("curve1")) {
      if (!circleName || !curveName) {
        throw new Error("REGION curve-circle form requires both curve and circle parameters");
      }
      const side = (params.get("side") || params.get("s") || "").trim().toLowerCase();
      if (side !== "above" && side !== "below") {
        throw new Error("REGION curve-circle form requires side=above or side=below");
      }
      const region2 = this.createCurveCircleRegion(name, curveName, circleName, side);
      this.state.objects.set(name, region2);
      const draw2 = params.get("draw");
      if (draw2 === "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, region2, void 0);
      }
      return;
    }
    if (circleName || lineName) {
      if (!circleName || !lineName) {
        throw new Error("REGION circle-line form requires both circle and line parameters");
      }
      const side = (params.get("side") || params.get("s") || "").trim().toLowerCase();
      if (side !== "left" && side !== "right") {
        throw new Error("REGION circle-line form requires side=left or side=right");
      }
      const region2 = this.createCircularRegion(name, circleName, lineName, side);
      this.state.objects.set(name, region2);
      const draw2 = params.get("draw");
      if (draw2 === "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, region2, void 0);
      }
      return;
    }
    const pointsParam = params.get("boundary") || params.get("points") || params.get("p");
    if (!pointsParam) {
      throw new Error("REGION command requires boundary, circle + line + side, or curve + circle + side parameters");
    }
    const pointNames = pointsParam.split(",").map((value) => value.trim()).filter(Boolean);
    if (pointNames.length > 1 && pointNames[0] === pointNames[pointNames.length - 1]) {
      pointNames.pop();
    }
    if (pointNames.length < 3) {
      throw new Error("REGION command requires at least 3 boundary points");
    }
    const points = [];
    for (const pointName of pointNames) {
      const point = this.getObject(pointName);
      if (!point || !(point instanceof Point)) {
        throw new Error(`Point ${pointName} not found or is not a valid point object`);
      }
      points.push(point);
    }
    this.validateSimpleRegionBoundary(name, points);
    const region = new Region(name, points);
    this.state.objects.set(name, region);
    const draw = params.get("draw");
    if (draw === "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, region, void 0);
    }
  }
  /**
   * 创建由 y=f(x) 曲线和圆弧围成的区域。
   * side=above/below 按圆弧中点相对曲线的 y 值选择边界，要求恰有两个交点。
   */
  createCurveCircleRegion(name, curveName, circleName, side) {
    const curve = this.getObject(curveName);
    if (!(curve instanceof Curve)) {
      throw new Error(`Object ${curveName} is not a function curve`);
    }
    const circle = this.getObject(circleName);
    if (!(circle instanceof Circle)) {
      throw new Error(`Object ${circleName} is not a circle`);
    }
    const rangeStart = Math.min(curve.rangeStart, curve.rangeEnd);
    const rangeEnd = Math.max(curve.rangeStart, curve.rangeEnd);
    const range = rangeEnd - rangeStart;
    if (!Number.isFinite(range) || range <= 1e-9) {
      throw new Error(`CURVE ${curveName} must have a non-zero x range`);
    }
    const circleEquation = (x) => {
      const y = curve.evaluate(x);
      return (x - circle.center.x) * (x - circle.center.x) + (y - circle.center.y) * (y - circle.center.y) - circle.radius * circle.radius;
    };
    const sampleCount = Math.min(1e4, Math.max(512, Math.ceil(range / Math.max(Math.abs(curve.sampleStep), 0.01))));
    const sampleStep = range / sampleCount;
    const roots = [];
    const rootEpsilon = 1e-8 * Math.max(1, circle.radius * circle.radius);
    const addRoot = (x) => {
      if (!Number.isFinite(x)) return;
      if (!roots.some((existing) => Math.abs(existing - x) <= Math.max(1e-7, sampleStep * 1e-3))) {
        roots.push(x);
      }
    };
    let previousX = rangeStart;
    let previousValue = circleEquation(previousX);
    if (Math.abs(previousValue) <= rootEpsilon) addRoot(previousX);
    for (let index = 1; index <= sampleCount; index++) {
      const currentX = index === sampleCount ? rangeEnd : rangeStart + index * sampleStep;
      const currentValue = circleEquation(currentX);
      if (Math.abs(currentValue) <= rootEpsilon) addRoot(currentX);
      if (previousValue < 0 && currentValue > 0 || previousValue > 0 && currentValue < 0) {
        let left = previousX;
        let right = currentX;
        let leftValue = previousValue;
        for (let iteration = 0; iteration < 60; iteration++) {
          const middle = (left + right) / 2;
          const middleValue = circleEquation(middle);
          if (Math.abs(middleValue) <= rootEpsilon) {
            left = middle;
            right = middle;
            break;
          }
          if (leftValue < 0 && middleValue > 0 || leftValue > 0 && middleValue < 0) {
            right = middle;
          } else {
            left = middle;
            leftValue = middleValue;
          }
        }
        addRoot((left + right) / 2);
      }
      previousX = currentX;
      previousValue = currentValue;
    }
    roots.sort((a, b) => a - b);
    if (roots.length < 2) {
      throw new Error(`REGION ${name} cannot be created: CURVE ${curveName} and CIRCLE ${circleName} do not have two intersections in the curve range`);
    }
    if (roots.length > 2) {
      throw new Error(`REGION ${name} is ambiguous: CURVE ${curveName} and CIRCLE ${circleName} have ${roots.length} intersections; exactly two are required`);
    }
    const leftX = roots[0];
    const rightX = roots[1];
    const leftPoint = { x: leftX, y: curve.evaluate(leftX) };
    const rightPoint = { x: rightX, y: curve.evaluate(rightX) };
    const curveSampleCount = Math.min(4096, Math.max(16, Math.ceil((rightX - leftX) / Math.max(Math.abs(curve.sampleStep), 0.01))));
    const curvePoints = [];
    for (let index = 0; index <= curveSampleCount; index++) {
      const x = leftX + (rightX - leftX) * index / curveSampleCount;
      curvePoints.push({ x, y: curve.evaluate(x) });
    }
    curvePoints[0] = leftPoint;
    curvePoints[curvePoints.length - 1] = rightPoint;
    const screenAngle = (point) => Math.atan2(-(point.y - circle.center.y), point.x - circle.center.x);
    const arcStartAngle = screenAngle(rightPoint);
    const arcEndAngle = screenAngle(leftPoint);
    const twoPi = Math.PI * 2;
    const normalizedDelta = (from, to, counterclockwise2) => {
      let delta = to - from;
      if (counterclockwise2) {
        while (delta > 0) delta -= twoPi;
        while (delta < -twoPi) delta += twoPi;
      } else {
        while (delta < 0) delta += twoPi;
        while (delta > twoPi) delta -= twoPi;
      }
      return delta;
    };
    const candidateIsOnRequestedSide = (counterclockwise2) => {
      const delta = normalizedDelta(arcStartAngle, arcEndAngle, counterclockwise2);
      const middleAngle = arcStartAngle + delta / 2;
      const middlePoint = {
        x: circle.center.x + circle.radius * Math.cos(middleAngle),
        y: circle.center.y - circle.radius * Math.sin(middleAngle)
      };
      const curveY = curve.evaluate(Math.min(rightX, Math.max(leftX, middlePoint.x)));
      const difference = middlePoint.y - curveY;
      const epsilon = 1e-8 * Math.max(1, circle.radius);
      return side === "above" ? difference > epsilon : difference < -epsilon;
    };
    const counterclockwise = candidateIsOnRequestedSide(true) ? true : candidateIsOnRequestedSide(false) ? false : (() => {
      throw new Error(`REGION ${name} could not determine the ${side} circle arc`);
    })();
    return new CurveCircleRegion(
      name,
      curve,
      circle,
      curvePoints,
      arcStartAngle,
      arcEndAngle,
      counterclockwise,
      side
    );
  }
  /**
   * 创建由圆弧和弦线围成的圆弓形区域。
   * side 按 line.p1 -> line.p2 的方向判断：left 为有向直线左侧，right 为右侧。
   */
  createCircularRegion(name, circleName, lineName, side) {
    const circle = this.getObject(circleName);
    if (!(circle instanceof Circle)) {
      throw new Error(`Object ${circleName} is not a circle`);
    }
    const line = this.getObject(lineName);
    if (!(line instanceof Line)) {
      throw new Error(`Object ${lineName} is not a LINE; circle-line REGION requires a LINE object`);
    }
    const dx = line.p2.x - line.p1.x;
    const dy = line.p2.y - line.p1.y;
    const directionLengthSquared = dx * dx + dy * dy;
    if (directionLengthSquared <= 1e-18) {
      throw new Error(`LINE ${lineName} has coincident defining points and cannot cut a circle`);
    }
    const intersections = circle.getIntersectionWithLine(line);
    if (intersections.length < 2) {
      if (intersections.length === 1) {
        throw new Error(`REGION ${name} cannot be created: LINE ${lineName} is tangent to CIRCLE ${circleName}, so it does not enclose an area`);
      }
      throw new Error(`REGION ${name} cannot be created: LINE ${lineName} does not intersect CIRCLE ${circleName}`);
    }
    const ordered = intersections.slice(0, 2).sort((a, b) => {
      const ta = ((a.x - line.p1.x) * dx + (a.y - line.p1.y) * dy) / directionLengthSquared;
      const tb = ((b.x - line.p1.x) * dx + (b.y - line.p1.y) * dy) / directionLengthSquared;
      return ta - tb;
    });
    const startPoint = ordered[0];
    const endPoint = ordered[1];
    const center = circle.center;
    const radius = circle.radius;
    const screenAngle = (point) => Math.atan2(-(point.y - center.y), point.x - center.x);
    const arcStartAngle = screenAngle(endPoint);
    const arcEndAngle = screenAngle(startPoint);
    const twoPi = Math.PI * 2;
    const normalizedDelta = (from, to, counterclockwise2) => {
      let delta = to - from;
      if (counterclockwise2) {
        while (delta > 0) delta -= twoPi;
        while (delta < -twoPi) delta += twoPi;
      } else {
        while (delta < 0) delta += twoPi;
        while (delta > twoPi) delta -= twoPi;
      }
      return delta;
    };
    const candidateIsOnRequestedSide = (counterclockwise2) => {
      const delta = normalizedDelta(arcStartAngle, arcEndAngle, counterclockwise2);
      const middleAngle = arcStartAngle + delta / 2;
      const middlePoint = {
        x: center.x + radius * Math.cos(middleAngle),
        y: center.y - radius * Math.sin(middleAngle)
      };
      const sideCross = dx * (middlePoint.y - line.p1.y) - dy * (middlePoint.x - line.p1.x);
      const epsilon = 1e-8 * Math.max(1, radius * Math.sqrt(directionLengthSquared));
      return side === "left" ? sideCross > epsilon : sideCross < -epsilon;
    };
    const counterclockwise = candidateIsOnRequestedSide(true) ? true : candidateIsOnRequestedSide(false) ? false : (() => {
      throw new Error(`REGION ${name} could not determine the ${side} arc of CIRCLE ${circleName}`);
    })();
    return new CircularRegion(
      name,
      circle,
      line,
      startPoint,
      endPoint,
      arcStartAngle,
      arcEndAngle,
      counterclockwise,
      side
    );
  }
  // 区域填充使用简单多边形的非零填充规则；自交边界会造成歧义，因此提前拒绝。
  validateSimpleRegionBoundary(name, points) {
    const epsilon = 1e-9;
    const samePoint = (a, b) => Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const onSegment = (a, b, p) => Math.min(a.x, b.x) - epsilon <= p.x && p.x <= Math.max(a.x, b.x) + epsilon && Math.min(a.y, b.y) - epsilon <= p.y && p.y <= Math.max(a.y, b.y) + epsilon;
    const intersects = (a, b, c, d) => {
      const abC = cross(a, b, c);
      const abD = cross(a, b, d);
      const cdA = cross(c, d, a);
      const cdB = cross(c, d, b);
      if ((abC > epsilon && abD < -epsilon || abC < -epsilon && abD > epsilon) && (cdA > epsilon && cdB < -epsilon || cdA < -epsilon && cdB > epsilon)) {
        return true;
      }
      return Math.abs(abC) <= epsilon && onSegment(a, b, c) || Math.abs(abD) <= epsilon && onSegment(a, b, d) || Math.abs(cdA) <= epsilon && onSegment(c, d, a) || Math.abs(cdB) <= epsilon && onSegment(c, d, b);
    };
    for (let i = 0; i < points.length; i++) {
      if (samePoint(points[i], points[(i + 1) % points.length])) {
        throw new Error(`REGION ${name} has two consecutive boundary points at the same position`);
      }
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      for (let j = i + 1; j < points.length; j++) {
        const adjacent = j === i + 1 || i === 0 && j === points.length - 1;
        if (adjacent) continue;
        const c = points[j];
        const d = points[(j + 1) % points.length];
        if (intersects(a, b, c, d)) {
          throw new Error(`REGION ${name} boundary self-intersects between edges ${i + 1} and ${j + 1}`);
        }
      }
    }
  }
  createTriangle(params) {
    const name = params.get("name");
    const p1Name = params.get("p1");
    const p2Name = params.get("p2");
    const p3Name = params.get("p3");
    if (!name || !p1Name || !p2Name || !p3Name) {
      throw new Error("TRIANGLE command requires name, p1, p2, and p3 parameters");
    }
    const p1 = this.getObject(p1Name);
    const p2 = this.getObject(p2Name);
    const p3 = this.getObject(p3Name);
    if (!p1 || !p2 || !p3) {
      throw new Error(`Points ${p1Name}, ${p2Name}, or ${p3Name} not found`);
    }
    const triangle = new Triangle(name, p1, p2, p3);
    this.state.objects.set(name, triangle);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, triangle, void 0);
    }
  }
  createRectangle(params) {
    const name = params.get("name");
    const p1Name = params.get("p1");
    const width = this.getNumberValue(params, "width") || this.getNumberValue(params, "w") || 0;
    const height = this.getNumberValue(params, "height") || this.getNumberValue(params, "h") || 0;
    if (!name || !p1Name || !width || !height) {
      throw new Error("RECTANGLE command requires name, p1, width, and height parameters");
    }
    const p1 = this.getObject(p1Name);
    if (!p1 || !(p1 instanceof Point)) {
      throw new Error(`Point ${p1Name} not found or is not a valid point object`);
    }
    const rectangle = Rectangle.fromWidthHeight(name, p1, width, height);
    this.state.objects.set(name, rectangle);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, rectangle, void 0);
    }
  }
  createCircle(params) {
    const name = params.get("name");
    if (!name) {
      throw new Error("CIRCLE command requires name parameters");
    }
    const centerName = params.get("center") || params.get("c");
    const radius = this.getNumberValue(params, "radius") || this.getNumberValue(params, "r") || 0;
    if (centerName && radius) {
      const center = this.getObject(centerName);
      if (!center || !(center instanceof Point)) {
        throw new Error(`Center point ${centerName} not found`);
      }
      const circle = Circle.fromRadius(name, center, radius);
      this.state.objects.set(name, circle);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, circle, void 0);
      }
      return;
    }
    const chordName = params.get("chord");
    if (centerName && chordName) {
      const center = this.getObject(centerName);
      const chord = this.getObject(chordName);
      if (!chord || !(chord instanceof Segment) || !center || !(center instanceof Point)) {
        throw new Error(`chord is is invalid`);
      }
      const circle = Circle.fromChord(name, center, chord.p1, chord.p2);
      this.state.objects.set(name, circle);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, circle, void 0);
      }
      return;
    }
    const chordPt1Name = params.get("chordPt1");
    const chordPt2Name = params.get("chordPt2");
    if (centerName && chordPt1Name && chordPt2Name) {
      const center = this.getObject(centerName);
      const chordPt1 = this.getObject(chordPt1Name);
      const chordPt2 = this.getObject(chordPt2Name);
      if (!center || !(center instanceof Point) || !chordPt1 || !(chordPt1 instanceof Point) || !chordPt2 || !(chordPt2 instanceof Point)) {
        throw new Error("create circle need center chordPt1 chordPt2");
      }
      const circle = Circle.fromChord(name, center, chordPt1, chordPt2);
      this.state.objects.set(name, circle);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, circle, void 0);
      }
      return;
    }
    const centerAngleName = params.get("centerAngle");
    if (chordName && centerAngleName) {
      const chord = this.getObject(chordName);
      const centerAngle = this.getNumberValue(params, centerAngleName);
      if (!chord || !(chord instanceof LinearObject) || !centerAngle) {
        throw new Error("create circle need chord centerAngle paramters");
      }
      const names = name.split(",");
      if (names.length == 1) {
        names.push(name + "_<next_circle>");
      }
      this.createCircleByCenterAngleAndChord(params, names[0], names[1], chord.p1, chord.p2, centerAngle);
      return;
    }
    if (chordPt1Name && chordPt2Name && centerAngleName) {
      const chordPt1 = this.getObject(chordPt1Name);
      const chordPt2 = this.getObject(chordPt2Name);
      const centerAngle = this.getNumberValue(params, centerAngleName);
      if (!centerAngle || !chordPt1 || !(chordPt1 instanceof Point) || !chordPt2 || !(chordPt2 instanceof Point)) {
        throw new Error("create circle need centerAngle chordPt1 chordPt2");
      }
      const names = name.split(",");
      if (names.length == 1) {
        names.push(name + "_<next_circle>");
      }
      this.createCircleByCenterAngleAndChord(params, names[0], names[1], chordPt1, chordPt2, centerAngle);
      return;
    }
  }
  createCircleByCenterAngleAndChord(params, name_1, name_2, chordPt1, chordPt2, centerAngle) {
    const midPoint = new PointNativeObject(
      (chordPt1.x + chordPt2.x) / 2,
      (chordPt1.y + chordPt2.y) / 2
    );
    const halfAngle = centerAngle / 2;
    const chordLength = chordPt1.distanceTo(chordPt2);
    if (GeometricObject.isZero(Math.cos(halfAngle))) {
      const circleCenter = new Point(name_1 + "<_circle_center>", midPoint.x, midPoint.y);
      const circle = Circle.fromRadius(name_1, circleCenter, chordLength / 2);
      this.state.objects.set(circle.name, circle);
      return { c1: circle, c2: circle };
    }
    if (GeometricObject.isZero(Math.sin(halfAngle))) {
      throw new Error("Angle cannot be 0 or a multiple of 2\u03C0, as this would imply an infinite radius for a non-zero chord.");
    }
    const halfChordLength = chordLength / 2;
    const radius = halfChordLength / Math.sin(halfAngle);
    const h = halfChordLength / Math.tan(halfAngle);
    const dx = chordPt2.x - chordPt1.x;
    const dy = chordPt2.y - chordPt1.y;
    const scale = h / chordLength;
    const offsetX = -dy * scale;
    const offsetY = dx * scale;
    const center1 = new Point(
      name_1 + "_<circle_center>",
      midPoint.x + offsetX,
      midPoint.y + offsetY
    );
    const center2 = new Point(
      name_2 + "_<circle_center>",
      midPoint.x - offsetX,
      midPoint.y - offsetY
    );
    this.state.objects.set(center1.name, center1);
    this.state.objects.set(center2.name, center2);
    const c1 = Circle.fromRadius(name_1, center1, radius);
    const c2 = Circle.fromRadius(name_2, center2, radius);
    this.state.objects.set(c1.name, c1);
    this.state.objects.set(c2.name, c2);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, c1, void 0);
      this.drawObject(this.state.ctx, params, c2, void 0);
    }
    return { c1, c2 };
  }
  createEllipse(params) {
    const name = params.get("name");
    const centerName = params.get("center") || params.get("c");
    const radiusX = this.getNumberValue(params, "radiusX") || this.getNumberValue(params, "rX") || 0;
    const radiusY = this.getNumberValue(params, "radiusY") || this.getNumberValue(params, "rY") || 0;
    const rotation = this.getNumberValue(params, "rotation") || this.getNumberValue(params, "rot") || 0;
    if (!name || !centerName || !radiusX || !radiusY) {
      throw new Error("ELLIPSE command requires name and center, radiusX, radiusY parameters");
    }
    const center = this.getObject(centerName);
    if (!center) {
      throw new Error(`Center point ${centerName} not found`);
    }
    const ellipse = new Ellipse(name, center, radiusX, radiusY, rotation);
    this.state.objects.set(name, ellipse);
    const draw = params.get("draw");
    if (draw != null && draw == "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, ellipse, void 0);
    }
  }
  createParabola(params) {
    const name = params.get("name") || params.get("n");
    if (!name) {
      throw new Error('Parabola command requires a "name" parameter.');
    }
    const vertexName = params.get("vertex") || params.get("v");
    const pValueStr = params.get("pValue") || params.get("p");
    const rotateAngleStr = params.get("rotateAngle") || params.get("rot") || "0";
    if (vertexName && pValueStr && rotateAngleStr) {
      const vertex = this.getObject(vertexName);
      if (!vertex || !(vertex instanceof Point)) {
        throw new Error(`Invalid vertex name for parabola: ${vertexName}`);
      }
      const pValue = this.getNumberValue(params, "pValue") || this.getNumberValue(params, "p");
      const rotateAngle = this.getNumberValue(params, "rotateAngle") || this.getNumberValue(params, "rot") || 0;
      if (pValue == null || isNaN(pValue) || rotateAngle == null || isNaN(rotateAngle)) {
        throw new Error("Invalid pValue or rotateAngle. They must be numbers.");
      }
      const parabola = new Parabola(name, vertex, pValue, rotateAngle);
      this.state.objects.set(name, parabola);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, parabola, void 0);
      }
      return;
    }
    const aStr = params.get("a");
    const bStr = params.get("b");
    const cStr = params.get("c");
    if (aStr !== void 0 && bStr !== void 0 && cStr !== void 0) {
      const a = this.getNumberValue(params, "a");
      const b = this.getNumberValue(params, "b");
      const c = this.getNumberValue(params, "c");
      if (a == null || b == null || c == null || isNaN(a) || isNaN(b) || isNaN(c)) {
        throw new Error("Parameters a, b, c must be numbers.");
      }
      if (a === 0) {
        throw new Error('Parameter "a" cannot be zero for a parabola.');
      }
      const h = -b / (2 * a);
      const k = a * h * h + b * h + c;
      const vertex = new Point(`${name}_vertex`, h, k);
      const pValue = Math.abs(1 / (2 * a));
      const rotateAngle = a > 0 ? -90 : 90;
      const parabola = new Parabola(name, vertex, pValue, rotateAngle);
      this.state.objects.set(name, parabola);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, parabola, void 0);
      }
      return;
    }
    throw new Error("To create a parabola, provide either {vertex, pValue, rotateAngle} or {a, b, c} parameters.");
  }
  createHyperbola(params) {
    const name = params.get("name") || params.get("n");
    if (!name) {
      throw new Error('Hyperbola command requires a "name" parameter.');
    }
    const centerName = params.get("center") || params.get("c");
    const aValueStr = params.get("aValue") || params.get("a");
    const bValueStr = params.get("bValue") || params.get("b");
    const rotateAngleStr = params.get("rotateAngle") || params.get("rot") || "0";
    if (centerName && aValueStr && bValueStr && rotateAngleStr) {
      const center = this.getObject(centerName);
      if (!center || !(center instanceof Point)) {
        throw new Error(`Invalid center name for hyperbola: ${centerName}`);
      }
      const aValue = this.getNumberValue(params, "aValue") || this.getNumberValue(params, "a");
      const bValue = this.getNumberValue(params, "bValue") || this.getNumberValue(params, "b");
      const rotateAngle = this.getNumberValue(params, "rotateAngle") || this.getNumberValue(params, "rot") || 0;
      if (aValue == null || bValue == null || rotateAngle == null || isNaN(aValue) || isNaN(bValue) || isNaN(rotateAngle) || aValue <= 0 || bValue <= 0) {
        throw new Error("Invalid aValue, bValue or rotateAngle. They must be positive numbers.");
      }
      const hyperbola = new Hyperbola(name, center, aValue, bValue, rotateAngle);
      this.state.objects.set(name, hyperbola);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, hyperbola, void 0);
      }
      return;
    }
    const f1Name = params.get("f1");
    const f2Name = params.get("f2");
    const diffStr = params.get("diff");
    if (f1Name && f2Name && diffStr) {
      const f1 = this.getObject(f1Name);
      const f2 = this.getObject(f2Name);
      if (!f1 || !(f1 instanceof Point) || !f2 || !(f2 instanceof Point)) {
        throw new Error(`Invalid foci names for hyperbola: ${f1Name}, ${f2Name}`);
      }
      const diff = this.getNumberValue(params, "diff");
      if (diff == null || isNaN(diff) || diff <= 0) {
        throw new Error('Invalid "diff" value. It must be a positive number.');
      }
      const centerX = (f1.x + f2.x) / 2;
      const centerY = (f1.y + f2.y) / 2;
      const center = new Point(`${name}_center`, centerX, centerY);
      const aValue = diff / 2;
      const cValue = Math.sqrt(Math.pow(f1.x - centerX, 2) + Math.pow(f1.y - centerY, 2));
      if (cValue <= aValue) {
        throw new Error(`Hyperbola construction failed: distance between foci (${2 * cValue}) must be greater than the constant difference (${diff}).`);
      }
      const bValue = Math.sqrt(cValue * cValue - aValue * aValue);
      const angleRad = Math.atan2(f2.y - f1.y, f2.x - f1.x);
      const rotateAngle = angleRad * (180 / Math.PI);
      const hyperbola = new Hyperbola(name, center, aValue, bValue, rotateAngle);
      this.state.objects.set(name, hyperbola);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, hyperbola, void 0);
      }
      return;
    }
    throw new Error("To create a hyperbola, provide either {center, aValue, bValue, rotateAngle} or {f1, f2, diff} parameters.");
  }
  createAngle(params) {
    const name = params.get("name");
    const vertexName = params.get("vertex") || params.get("v");
    const point1Name = params.get("p1");
    const point2Name = params.get("p2");
    const angleValue = this.getNumberValue(params, "angle") || this.getNumberValue(params, "a") || 0;
    const showArc = _GeometryDSLInterpreter.parseBoolean(params.get("showArc") || "true");
    if (!name || !vertexName || !point1Name) {
      throw new Error("ANGLE command requires name, vertex, p1, and p2 parameters");
    }
    const vertex = this.getObject(vertexName);
    const point1 = this.getObject(point1Name);
    if (point2Name) {
      const point2 = this.getObject(point2Name);
      if (!vertex || !point1 || !point2) {
        throw new Error(`Points ${vertexName}, ${point1Name}, or ${point2Name} not found`);
      }
      const angle = new Angle(name, vertex, point1, point2, showArc);
      this.state.objects.set(name, angle);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, angle, void 0);
      }
    } else {
      if (!vertex || !point1) {
        throw new Error(`Points ${vertexName} or ${point1Name} not found`);
      }
      const tempSegment = new Segment(name + "_<temp>", vertex, point1);
      const point2Pos = tempSegment.rotateAroundPoint(angleValue * Math.PI / 180, vertex, false);
      const point2 = new Point(name + "_<point2>", point2Pos.p2.x, point2Pos.p2.y);
      this.state.objects.set(point2.name, point2);
      const angle = new Angle(name, vertex, point1, point2, showArc);
      this.state.objects.set(name, angle);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, angle, void 0);
      }
    }
  }
  createFocis(params) {
    const name = params.get("name");
    const objectName = params.get("obj") || params.get("o");
    if (!name || !objectName) {
      throw new Error("FOCUS command requires name and point parameters");
    }
    const obj = this.getObject(objectName);
    if (!obj) {
      throw new Error(`Point ${objectName} not found`);
    }
    if (!(obj instanceof Ellipse)) {
      throw new Error(`Object ${objectName} is not a valid conic section for focus creation`);
    }
    if (obj instanceof Ellipse) {
      const parts = name.split(",");
      if (parts.length !== 2) {
        throw new Error('FOCUS command requires name to be in format "focus1,focus2" for ellipse');
      }
      const objEllipse = obj;
      const points = objEllipse.getFoci();
      const pt1 = new Point(parts[0].trim(), points[0].x, points[0].y);
      const pt2 = new Point(parts[1].trim(), points[1].x, points[1].y);
      this.state.objects.set(pt1.name, pt1);
      this.state.objects.set(pt2.name, pt2);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, pt1, pt1.name);
        this.drawObject(this.state.ctx, params, pt2, pt2.name);
      }
    }
  }
  // 创建随机点
  createRandomPoint(params) {
    const name = params.get("name");
    const objName = params.get("obj") || params.get("o");
    if (!name || !objName) {
      throw new Error("RANDOMPOINT command requires name, obj parameter");
    }
    const start = params.get("start") || params.get("s");
    const end = params.get("end") || params.get("e");
    const randomSource = `RANDOMPOINT obj=${objName}${start !== void 0 ? ` start=${start}` : ""}${end !== void 0 ? ` end=${end}` : ""}`;
    const frozenPoint = this.state.frozenRandomObjects.get(name);
    const obj = this.getObject(objName);
    if (!obj) {
      throw new Error(`Object ${objName} not found`);
    }
    if (obj instanceof LinearObject) {
      const line = obj;
      const startPos = parseFloat(start || "0");
      const endPos = parseFloat(end || "1");
      const randomPoint = frozenPoint || line.randomPointOnLine(startPos, endPos);
      const point = new Point(name, randomPoint.x, randomPoint.y);
      this.state.objects.set(name, point);
      this.state.randomObjectSources.set(name, randomSource);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, point, name);
      }
      return;
    }
    if (obj instanceof Circle) {
      const circle = obj;
      const startAngle = parseFloat(start || "0");
      const endAngle = parseFloat(end || "360");
      const randomPoint = frozenPoint || circle.randomPointOnEdge(startAngle, endAngle);
      const point = new Point(name, randomPoint.x, randomPoint.y);
      this.state.objects.set(name, point);
      this.state.randomObjectSources.set(name, randomSource);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
        this.drawObject(this.state.ctx, params, point, name);
      }
      return;
    }
    if (obj instanceof Ellipse) {
      const ellipse = obj;
      const startAngle = parseFloat(start || "0");
      const endAngle = parseFloat(end || "360");
      const randomPoint = frozenPoint || ellipse.randomPointOnEdge(startAngle, endAngle);
      const point = new Point(name, randomPoint.x, randomPoint.y);
      this.state.objects.set(name, point);
      this.state.randomObjectSources.set(name, randomSource);
      const draw = params.get("draw");
      if (draw != null && draw == "true" && this.state.ctx) {
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
  createSlot(params) {
    const name = params.get("name");
    const valueString = params.get("value") || params.get("v") || params.get("expression") || params.get("e");
    if (!name || !valueString) {
      throw new Error("SLOT command requires name and expression parameters");
    }
    const slotType = params.get("type") || params.get("t") || "number";
    const isRandomExpression = /\brandom\s*\(/i.test(valueString);
    if (slotType.toLowerCase() === "string") {
      this.state.slots.set(name, valueString);
      this.state.variableInfo.set(name, {
        name,
        expression: valueString,
        value: valueString,
        kind: "fixed",
        frozen: false
      });
    } else {
      const existingFrozenValue = isRandomExpression ? this.state.frozenRandomValues.get(name) : void 0;
      const value = existingFrozenValue ?? (this.getNumberValue(params, "value") || this.getNumberValue(params, "v") || this.getNumberValue(params, "expression") || this.getNumberValue(params, "e") || 0);
      this.state.slots.set(name, value);
      this.state.variableInfo.set(name, {
        name,
        expression: valueString,
        value,
        kind: isRandomExpression ? "random" : "fixed",
        frozen: isRandomExpression && existingFrozenValue !== void 0
      });
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
  createFunction(params) {
    const name = params.get("name") || params.get("n");
    const argsStr = params.get("args") || params.get("a");
    let value = params.get("value") || params.get("v") || params.get("expression") || params.get("e");
    if (!name || !argsStr || value === void 0) {
      throw new Error('FUNCTION command requires "name", "args", and "value" parameters.');
    }
    if (this.state.functions.has(name)) {
      throw new Error(`Function name "${name}" is already defined.`);
    }
    const argCount = parseInt(argsStr, 10);
    if (isNaN(argCount) || argCount < 0) {
      throw new Error(`Invalid number of arguments: ${argsStr}`);
    }
    if (value.startsWith("{") && value.endsWith("}")) {
      value = value.slice(1, -1);
    }
    const customFunction = {
      name,
      argCount,
      expression: value
    };
    this.state.functions.set(name, customFunction);
  }
  /**
   * 创建曲线，需要传递一个Function对象。
   * 
   */
  createCurve(params) {
    const name = params.get("name") || params.get("n");
    const funcName = params.get("func") || params.get("f");
    const xStart = this.getNumberValue(params, "xstart") || this.getNumberValue(params, "xs") || 0;
    const xEnd = this.getNumberValue(params, "xend") || this.getNumberValue(params, "xe") || 0;
    if (!name || !funcName) {
      throw new Error("CURVE command requires name and func parameters.");
    }
    const customFunction = this.state.functions.get(funcName);
    if (!customFunction) {
      throw new Error(`Function "${funcName}" not found.`);
    }
    if (customFunction.argCount !== 1) {
      throw new Error(`Function "${funcName}" must have exactly one argument for CURVE.`);
    }
    const curveLambda = (x) => {
      this.state.slots.set("args[1]", x);
      const result = this.executeSlotExpression(customFunction.expression);
      return result;
    };
    const curve = new Curve(name, xStart, xEnd, curveLambda, null);
    this.state.objects.set(name, curve);
    const draw = params.get("draw");
    if (draw === "true" && this.state.ctx) {
      this.drawObject(this.state.ctx, params, curve, void 0);
    }
  }
  createAnimation(params) {
    const name = params.get("name");
    const interval = parseFloat(params.get("interval") || "1000");
    const repeat = _GeometryDSLInterpreter.parseBoolean(params.get("repeat") || "false");
    const periodValue = params.get("period") || params.get("frames") || params.get("periodFrames");
    const parsedPeriod = periodValue === void 0 ? NaN : Number(periodValue);
    const period = Number.isInteger(parsedPeriod) && parsedPeriod > 0 ? parsedPeriod : void 0;
    const code = params.get("code") || params.get("c");
    const slotName = params.get("slot") || params.get("s");
    if (!name || !code || !slotName) {
      throw new Error("ANIMATION command requires name, execute, update parameter");
    }
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
    this.state.slots.set(slotName, 0);
    const animation = {
      name,
      code,
      slot: slotName,
      isRepeat: repeat,
      currentFrame: 0,
      interval,
      period,
      isRunning: true,
      animationTimer: 0
    };
    if (this.state.animationAutoStart) {
      animation.animationTimer = setTimeout(() => {
        this.runAnimationCode(animation);
      }, 0);
    }
    this.state.animations.set(name, animation);
  }
  // 执行动画代码
  runAnimationCode(animation) {
    if (!this.state.ctx) return;
    const commands = this.state.codes.get(animation.code);
    if (!commands) {
      console.error(`Animation ${animation.name}: code ${animation.code} not found`);
      return;
    }
    this.executeLines(commands.map((x) => x.rawCommand), false);
    if (animation.isRunning === false) {
      console.log(`Animation ${animation.name} is not running, stopping execution.`);
      return;
    }
    animation.currentFrame++;
    this.state.slots.set(animation.slot, animation.currentFrame);
    if (animation.isRepeat && this.state.animationAutoStart) {
      animation.animationTimer = setTimeout(() => {
        this.runAnimationCode(animation);
      }, animation.interval);
    } else if (!animation.isRepeat) {
      animation.isRunning = false;
      console.log(`Animation ${animation.name} completed after ${animation.currentFrame} frames`);
    }
  }
  // private parseColor(colorString: string): string | undefined;
  parseColor(args1, args2) {
    const parseColorInternal = (colorString) => {
      if (!colorString) {
        return colorString;
      }
      const hexRegex = /^[0-9a-fA-F]{6}$/;
      if (hexRegex.test(colorString)) {
        return `#${colorString.toUpperCase()}`;
      } else {
        return colorString;
      }
    };
    const params = args1;
    const colorValue = params.get(args2);
    if (colorValue == null) {
      return void 0;
    }
    const reg = /\{([^}]+)\}/;
    if (reg.test(colorValue)) {
      const slotName = reg.exec(colorValue)[1].trim();
      const slotValue = this.state.slots.get(slotName);
      if (slotValue == null) {
        return void 0;
      }
      return parseColorInternal(slotValue.toString());
    } else {
      return parseColorInternal(colorValue);
    }
  }
  // 辅助方法
  drawLabel(obj, label, params, transform) {
    if (!this.state.ctx) return;
    let direction = params.get("direction") || params.get("d") || "down";
    if (direction === "down" || direction === "d") {
      direction = "down";
    }
    if (direction === "up" || direction === "u") {
      direction = "up";
    }
    if (direction === "left" || direction === "l") {
      direction = "left";
    }
    if (direction === "right" || direction === "r") {
      direction = "right";
    }
    if (direction !== "down" && direction !== "up" && direction !== "left" && direction !== "right") {
      throw new Error(`Invalid label direction: ${direction}. Use 'up', 'down', 'left', or 'right'.`);
    }
    obj.drawLabel(this.state.ctx, transform, label, {
      drawDirection: direction,
      fontSize: parseFloat(params.get("fontSize") || params.get("fs") || "12"),
      color: this.parseColor(params, "color") || this.parseColor(params, "c") || this.state.defaultOptions.labelColor,
      backgroundColor: this.parseColor(params, "backgroundColor") || this.parseColor(params, "bgc") || "transparent",
      padding: parseFloat(params.get("padding") || params.get("p") || "2")
    });
  }
  // 公共方法，获取命名对象
  getObject(name) {
    if (name == null || name === "") {
      return void 0;
    }
    const existNameObject = this.state.objects.get(name);
    if (existNameObject) {
      return existNameObject;
    }
    const existSlotValue = this.state.slots.get(name);
    if (existSlotValue !== void 0) {
      return this.state.objects.get(existSlotValue.toString());
    }
    const reg = /\{([^}]+)\}/;
    if (reg.test(name)) {
      const slotName = reg.exec(name)[1].trim();
      const slotValue = this.state.slots.get(slotName);
      if (slotValue === void 0) {
        return void 0;
      }
      return this.state.objects.get(slotValue.toString());
    }
  }
  // 查找一个点是否已经命名
  findPoint(x, y) {
    for (let geoObjectKV of this.state.objects) {
      let geoObject = geoObjectKV[1];
      if (geoObject instanceof Point) {
        const distance = geoObject.distanceTo2(x, y);
        if (distance <= this.zeroThresholdValue) {
          return geoObject;
        }
      }
    }
    return void 0;
  }
  getAllObjects() {
    return new Map(this.state.objects);
  }
  setCanvas(canvas) {
    this.state.canvas = canvas;
    this.state.ctx = canvas.getContext("2d") || void 0;
  }
};

// AiGeometryBroad/src/core/SvgRenderContext.ts
var DEFAULT_STYLE = {
  strokeStyle: "black",
  fillStyle: "black",
  lineWidth: 1,
  lineDash: [],
  font: "12px Arial",
  lineCap: "butt",
  lineJoin: "miter"
};
function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function normalizeColor(color) {
  if (!color) return "black";
  const value = color.trim();
  if (value === "transparent") return "none";
  return value;
}
function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1e3) / 1e3);
}
var SvgRenderContext = class {
  elements = [];
  styleStack = [];
  style = { ...DEFAULT_STYLE };
  subpaths = [];
  currentPath = null;
  width;
  height;
  bounds = null;
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  // 供外部读取 canvas.width / canvas.height
  get canvas() {
    return { width: this.width, height: this.height };
  }
  // 修改画布尺寸（用于设置导出区域）
  setSize(width, height) {
    this.width = width;
    this.height = height;
  }
  // ---------- 样式属性 ----------
  get strokeStyle() {
    return this.style.strokeStyle;
  }
  set strokeStyle(value) {
    this.style.strokeStyle = value;
  }
  get fillStyle() {
    return this.style.fillStyle;
  }
  set fillStyle(value) {
    this.style.fillStyle = value;
  }
  get lineWidth() {
    return this.style.lineWidth;
  }
  set lineWidth(value) {
    this.style.lineWidth = value;
  }
  get lineCap() {
    return this.style.lineCap;
  }
  set lineCap(value) {
    this.style.lineCap = value;
  }
  get lineJoin() {
    return this.style.lineJoin;
  }
  set lineJoin(value) {
    this.style.lineJoin = value;
  }
  get font() {
    return this.style.font;
  }
  set font(value) {
    this.style.font = value;
  }
  // ---------- 状态栈 ----------
  save() {
    this.styleStack.push({ ...this.style, lineDash: [...this.style.lineDash] });
  }
  restore() {
    const previous = this.styleStack.pop();
    if (previous) {
      this.style = previous;
    }
  }
  setLineDash(dash) {
    this.style.lineDash = dash ? [...dash] : [];
  }
  getLineDash() {
    return [...this.style.lineDash];
  }
  // ---------- 路径构建 ----------
  beginPath() {
    this.subpaths = [];
    this.currentPath = null;
  }
  // 返回当前子路径，必要时自动创建
  ensurePath() {
    if (!this.currentPath) {
      this.currentPath = [];
      this.subpaths.push(this.currentPath);
    }
    return this.currentPath;
  }
  closePath() {
    if (this.currentPath && this.currentPath.length > 0) {
      this.currentPath.push("Z");
      this.currentPath = null;
    }
  }
  moveTo(x, y) {
    this.currentPath = [`M ${formatNumber(x)} ${formatNumber(y)}`];
    this.subpaths.push(this.currentPath);
  }
  lineTo(x, y) {
    const path = this.ensurePath();
    if (path.length === 0) {
      path.push(`M ${formatNumber(x)} ${formatNumber(y)}`);
      return;
    }
    path.push(`L ${formatNumber(x)} ${formatNumber(y)}`);
  }
  arc(x, y, radius, startAngle, endAngle, counterclockwise = false) {
    this.appendArcAsBezier(x, y, radius, radius, 0, startAngle, endAngle, counterclockwise);
  }
  ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise = false) {
    this.appendArcAsBezier(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise);
  }
  rect(x, y, width, height) {
    this.moveTo(x, y);
    this.lineTo(x + width, y);
    this.lineTo(x + width, y + height);
    this.lineTo(x, y + height);
    this.closePath();
  }
  // 用三次贝塞尔近似圆弧：Canvas 的 arc/ellipse 都可以这样转换
  appendArcAsBezier(cx, cy, rx, ry, rotation, startAngle, endAngle, counterclockwise) {
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || Math.abs(rx) < 1e-9 || Math.abs(ry) < 1e-9) {
      return;
    }
    const cosRot = Math.cos(rotation);
    const sinRot = Math.sin(rotation);
    const pointAt = (t) => {
      const localX = rx * Math.cos(t);
      const localY = ry * Math.sin(t);
      return {
        x: cx + localX * cosRot - localY * sinRot,
        y: cy + localX * sinRot + localY * cosRot
      };
    };
    let delta = endAngle - startAngle;
    const twoPi = Math.PI * 2;
    if (!counterclockwise) {
      while (delta < 0) delta += twoPi;
      while (delta > twoPi) delta -= twoPi;
    } else {
      while (delta > 0) delta -= twoPi;
      while (delta < -twoPi) delta += twoPi;
    }
    const segmentCount = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
    const step = delta / segmentCount;
    const start = pointAt(startAngle);
    const path = this.ensurePath();
    if (path.length === 0) {
      path.push(`M ${formatNumber(start.x)} ${formatNumber(start.y)}`);
    } else {
      path.push(`L ${formatNumber(start.x)} ${formatNumber(start.y)}`);
    }
    for (let i = 0; i < segmentCount; i++) {
      const t0 = startAngle + step * i;
      const t1 = startAngle + step * (i + 1);
      const p0 = pointAt(t0);
      const p1 = pointAt(t1);
      const alpha = Math.abs(step) * 0.5;
      const k = 4 / 3 * Math.tan(alpha / 2) * (step < 0 ? -1 : 1);
      const d0 = { x: -rx * Math.sin(t0), y: ry * Math.cos(t0) };
      const d1 = { x: -rx * Math.sin(t1), y: ry * Math.cos(t1) };
      const c0 = {
        x: p0.x + k * (d0.x * cosRot - d0.y * sinRot),
        y: p0.y + k * (d0.x * sinRot + d0.y * cosRot)
      };
      const c1 = {
        x: p1.x - k * (d1.x * cosRot - d1.y * sinRot),
        y: p1.y - k * (d1.x * sinRot + d1.y * cosRot)
      };
      path.push(
        `C ${formatNumber(c0.x)} ${formatNumber(c0.y)} ${formatNumber(c1.x)} ${formatNumber(c1.y)} ${formatNumber(p1.x)} ${formatNumber(p1.y)}`
      );
    }
  }
  getPathData() {
    return this.subpaths.map((path) => path.join(" ")).join(" ");
  }
  // ---------- 绘制 ----------
  fill() {
    this.includePathBounds();
    const d = this.getPathData();
    if (!d) return;
    const attrs = [
      `d="${d}"`,
      `fill="${escapeXml(normalizeColor(this.style.fillStyle))}"`,
      `fill-rule="nonzero"`,
      'stroke="none"'
    ].join(" ");
    this.elements.push(`<path ${attrs} />`);
  }
  stroke() {
    this.includePathBounds();
    const d = this.getPathData();
    if (!d) return;
    const dash = this.style.lineDash.length > 0 ? ` stroke-dasharray="${this.style.lineDash.map(formatNumber).join(",")}"` : "";
    const attrs = [
      `d="${d}"`,
      'fill="none"',
      `stroke="${escapeXml(normalizeColor(this.style.strokeStyle))}"`,
      `stroke-width="${formatNumber(this.style.lineWidth)}"`,
      `stroke-linecap="${this.style.lineCap}"`,
      `stroke-linejoin="${this.style.lineJoin}"`
    ].join(" ") + dash;
    this.elements.push(`<path ${attrs} />`);
  }
  fillRect(x, y, width, height) {
    const attrs = [
      `x="${formatNumber(x)}"`,
      `y="${formatNumber(y)}"`,
      `width="${formatNumber(width)}"`,
      `height="${formatNumber(height)}"`,
      `fill="${escapeXml(normalizeColor(this.style.fillStyle))}"`
    ].join(" ");
    const isCanvasBackground = x === 0 && y === 0 && width === this.width && height === this.height;
    if (!isCanvasBackground) {
      this.includeRect(x, y, width, height);
    }
    this.elements.push(`<rect ${attrs} />`);
  }
  strokeRect(x, y, width, height) {
    const dash = this.style.lineDash.length > 0 ? ` stroke-dasharray="${this.style.lineDash.map(formatNumber).join(",")}"` : "";
    const attrs = [
      `x="${formatNumber(x)}"`,
      `y="${formatNumber(y)}"`,
      `width="${formatNumber(width)}"`,
      `height="${formatNumber(height)}"`,
      'fill="none"',
      `stroke="${escapeXml(normalizeColor(this.style.strokeStyle))}"`,
      `stroke-width="${formatNumber(this.style.lineWidth)}"`
    ].join(" ") + dash;
    this.includeRect(x, y, width, height, this.style.lineWidth / 2);
    this.elements.push(`<rect ${attrs} />`);
  }
  // ---------- 文本 ----------
  measureText(text) {
    return { width: this.estimateTextWidth(text) };
  }
  fillText(text, x, y) {
    const fontSize = this.getFontSize();
    const fontFamily = this.getFontFamily();
    const fontWeight = /\b(bold|bolder|lighter|[1-9]00)\b/.exec(this.style.font)?.[1] ?? "normal";
    const fontStyle = /\b(italic|oblique)\b/.exec(this.style.font)?.[1] ?? "normal";
    const attrs = [
      `x="${formatNumber(x)}"`,
      `y="${formatNumber(y)}"`,
      `fill="${escapeXml(normalizeColor(this.style.fillStyle))}"`,
      `font-size="${formatNumber(fontSize)}"`,
      `font-family="${escapeXml(fontFamily)}"`,
      fontStyle !== "normal" ? `font-style="${fontStyle}"` : "",
      fontWeight !== "normal" ? `font-weight="${fontWeight}"` : ""
    ].filter(Boolean).join(" ");
    this.includeRect(x, y - fontSize, this.estimateTextWidth(text), fontSize);
    this.elements.push(`<text ${attrs}>${escapeXml(text)}</text>`);
  }
  getFontSize() {
    const match = /(\d+(?:\.\d+)?)px/.exec(this.style.font);
    return match ? parseFloat(match[1]) : 12;
  }
  // canvas font 形如 "normal normal 12px Arial" 或 "bold italic 14px sans-serif"
  getFontFamily() {
    const withoutSize = this.style.font.replace(/\d+(?:\.\d+)?px/, "");
    const cleaned = withoutSize.replace(/\b(normal|italic|oblique|bold|bolder|lighter|[1-9]00)\b/g, "").replace(/\s+/g, " ").trim();
    return cleaned || "Arial";
  }
  // Canvas 的 measureText 需要真实字体度量，这里用经验系数近似，避免依赖浏览器
  estimateTextWidth(text) {
    const fontSize = this.getFontSize();
    let width = 0;
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      width += code > 11904 ? fontSize : fontSize * 0.55;
    }
    return width;
  }
  // ---------- 输出 ----------
  getElements() {
    return [...this.elements];
  }
  getBounds() {
    return this.bounds ? { ...this.bounds } : null;
  }
  includePoint(x, y, padding = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const minX = x - padding;
    const minY = y - padding;
    const maxX = x + padding;
    const maxY = y + padding;
    if (!this.bounds) {
      this.bounds = { minX, minY, maxX, maxY };
      return;
    }
    this.bounds.minX = Math.min(this.bounds.minX, minX);
    this.bounds.minY = Math.min(this.bounds.minY, minY);
    this.bounds.maxX = Math.max(this.bounds.maxX, maxX);
    this.bounds.maxY = Math.max(this.bounds.maxY, maxY);
  }
  includeRect(x, y, width, height, padding = 0) {
    this.includePoint(x, y, padding);
    this.includePoint(x + width, y + height, padding);
  }
  includePathBounds() {
    const padding = Math.max(0, this.style.lineWidth / 2);
    for (const path of this.subpaths) {
      for (const token of path) {
        const values = token.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
        for (let i = 0; i + 1 < values.length; i += 2) {
          this.includePoint(values[i], values[i + 1], padding);
        }
      }
    }
    if (this.currentPath) {
      for (const token of this.currentPath) {
        const values = token.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
        for (let i = 0; i + 1 < values.length; i += 2) {
          this.includePoint(values[i], values[i + 1], padding);
        }
      }
    }
  }
  toSVG(options) {
    const background = options?.background;
    const fitContent = options?.fitContent !== false;
    const padding = Math.max(0, options?.padding ?? 12);
    const sourceBounds = options?.contentBounds || this.bounds;
    const cropBounds = fitContent && sourceBounds ? {
      minX: sourceBounds.minX - padding,
      minY: sourceBounds.minY - padding,
      maxX: sourceBounds.maxX + padding,
      maxY: sourceBounds.maxY + padding
    } : { minX: 0, minY: 0, maxX: this.width, maxY: this.height };
    const outputWidth = Math.max(1, cropBounds.maxX - cropBounds.minX);
    const outputHeight = Math.max(1, cropBounds.maxY - cropBounds.minY);
    const width = formatNumber(outputWidth);
    const height = formatNumber(outputHeight);
    const normalizedBackground = background ? normalizeColor(background) : "none";
    const backgroundRect = normalizedBackground !== "none" ? `<rect x="${formatNumber(cropBounds.minX)}" y="${formatNumber(cropBounds.minY)}" width="${width}" height="${height}" fill="${escapeXml(normalizedBackground)}" />` : "";
    const animation = options?.animation;
    if (!animation || animation.frames.length === 0) {
      return [
        `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="${formatNumber(cropBounds.minX)} ${formatNumber(cropBounds.minY)} ${width} ${height}">`,
        backgroundRect,
        ...this.elements,
        "</svg>"
      ].filter(Boolean).join("\n");
    }
    const frameCount = animation.frames.length;
    const durationMs = Math.max(1, animation.durationMs);
    const duration = formatNumber(durationMs / 1e3);
    const framePercent = formatNumber(100 / frameCount);
    const frameDuration = durationMs / frameCount;
    const frameGroups = animation.frames.map((frame, index) => {
      const delay = formatNumber(-((frameCount - index) * frameDuration) / 1e3);
      const initialOpacity = index === 0 ? 1 : 0;
      const start = formatNumber(index / frameCount);
      const end = formatNumber((index + 1) / frameCount);
      const smilAnimation = index === 0 ? `<animate attributeName="opacity" dur="${duration}s" repeatCount="indefinite" values="1;1;0" keyTimes="0;${end};1" calcMode="discrete" />` : `<animate attributeName="opacity" dur="${duration}s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;${start};${end};1" calcMode="discrete" />`;
      const style = `opacity: ${initialOpacity}; animation: geometry-frame-cycle ${duration}s steps(1, end) infinite; animation-delay: ${delay}s;`;
      return `<g style="${style}">${smilAnimation}${frame.join("\n")}</g>`;
    });
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="${formatNumber(cropBounds.minX)} ${formatNumber(cropBounds.minY)} ${width} ${height}">`,
      "<style>",
      `@keyframes geometry-frame-cycle { 0%, ${framePercent}% { opacity: 1; } ${framePercent}%, 100% { opacity: 0; } }`,
      "</style>",
      backgroundRect,
      ...this.elements,
      ...frameGroups,
      "</svg>"
    ].filter(Boolean).join("\n");
  }
};

// AiGeometryBroad/src/core/svgExport.ts
var DEFAULT_VIEW = {
  centerX: 0,
  centerY: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0
};
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function inferAnimationFrames(script2, slot) {
  const slotPattern = escapeRegExp(slot);
  const forward = new RegExp(`${slotPattern}\\s*%\\s*(\\d+)`, "i").exec(script2);
  const backward = new RegExp(`(\\d+)\\s*%\\s*${slotPattern}`, "i").exec(script2);
  const value = parseInt(forward?.[1] || backward?.[1] || "", 10);
  return Number.isFinite(value) && value > 1 ? value : void 0;
}
function unionBounds(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}
function exportScriptToSvg(script2, options) {
  const { width, height, background = "transparent" } = options;
  const view = { ...DEFAULT_VIEW, ...options.view || {} };
  const context = new SvgRenderContext(width, height);
  const createVirtualCanvas = (target) => ({
    width,
    height,
    getContext: (type) => type === "2d" ? target : null
  });
  const virtualCanvas = createVirtualCanvas(context);
  const interpreter = new GeometryDSLInterpreter(virtualCanvas, options.onMessage);
  interpreter.setAnimationAutoStart(false);
  interpreter.setTransform(virtualCanvas, {
    x: view.offsetX,
    y: view.offsetY,
    scale: view.scale
  });
  interpreter.setViewCenter(view.centerX, view.centerY);
  interpreter.setContextPreTransformed(false);
  interpreter.setRenderTransform({
    scale: view.scale,
    offsetX: view.offsetX,
    offsetY: view.offsetY
  });
  interpreter.execute(script2);
  const animations = interpreter.getAnimationDefinitions();
  if (animations.length === 0) {
    return context.toSVG({ background });
  }
  const primaryAnimation = animations[0];
  const defaultFrames = options.animationFrames && options.animationFrames > 0 ? Math.floor(options.animationFrames) : 60;
  const inferredFrames = inferAnimationFrames(script2, primaryAnimation.slot);
  const frameCount = Math.max(1, Math.floor(
    primaryAnimation.period || inferredFrames || (primaryAnimation.isRepeat ? defaultFrames : 1)
  ));
  const frameInterval = Math.max(1, primaryAnimation.interval);
  const frames = [];
  let contentBounds = context.getBounds();
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const frameContext = new SvgRenderContext(width, height);
    const frameCanvas = createVirtualCanvas(frameContext);
    interpreter.setRenderTarget(frameCanvas, frameContext);
    interpreter.setContextPreTransformed(false);
    for (const animation of animations) {
      if (animation.isRepeat || frameIndex === 0) {
        interpreter.stepAnimation(animation.name);
      }
    }
    frames.push(frameContext.getElements());
    contentBounds = unionBounds(contentBounds, frameContext.getBounds());
  }
  return context.toSVG({
    background,
    contentBounds,
    animation: {
      frames,
      durationMs: frameCount * frameInterval
    }
  });
}

// AiGeometryBroad/scripts/render-screenshot-problem.ts
var scriptPath = "D:/Projects/JS/GeometryBroad/outputs/screenshot-geometry-problem.dsl";
var outputPath = "D:/Projects/JS/GeometryBroad/outputs/screenshot-geometry-problem.svg";
var script = readFileSync(scriptPath, "utf8");
var messages = [];
var svg = exportScriptToSvg(script, {
  width: 960,
  height: 720,
  background: "white",
  onMessage: (level, line, message) => messages.push(`[${level}] line ${line}: ${message}`)
});
writeFileSync(outputPath, svg, "utf8");
if (messages.length > 0) {
  console.warn(messages.join("\n"));
}
console.log(`Wrote ${outputPath}`);
