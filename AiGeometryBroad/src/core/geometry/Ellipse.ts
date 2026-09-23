import { GeometricObject, type DrawOptions, type DrawLabelOptions, type IPoint, toScreenPoint, resolveLineWidth } from './base';
import { Point, PointNativeObject } from './Point';
import { LinearNativeObject } from './LinearObject';

export class Ellipse extends GeometricObject {
  public center: Point;
  public rx: number; // 半长轴
  public ry: number; // 半短轴
  public rotation: number; // 旋转角度 (弧度)

  constructor(name: string, center: Point, rx: number, ry: number, rotationDegrees: number = 0) {
    super(name, 'ellipse');
    this.center = center;
    this.rx = rx;
    this.ry = ry;
    this.rotation = rotationDegrees * (Math.PI / 180); // 内部存储为弧度
  }

  public draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void {
    ctx.save();
    ctx.beginPath();

    // Apply transformations
    const centerTransformed = this.center.transform(transform.scale, transform.offsetX, transform.offsetY);

    const transformedRx = this.rx * transform.scale;
    const transformedRy = this.ry * transform.scale;

    ctx.ellipse(centerTransformed.x, 0 - centerTransformed.y, transformedRx, transformedRy, 0 - this.rotation, 0, 2 * Math.PI);

    if (options?.fillColor) {
      ctx.fillStyle = options.fillColor;
      ctx.fill();
    }

    ctx.strokeStyle = options?.color || 'black';
    ctx.lineWidth = resolveLineWidth(options?.lineWidth, transform.scale) * (options?.highlight ? 2 : 1);

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
  private _getTransformedPoint(localX: number, localY: number): PointNativeObject {
    const cosR = Math.cos(this.rotation);
    const sinR = Math.sin(this.rotation);

    // 2. 旋转
    const rotatedX = localX * cosR - localY * sinR;
    const rotatedY = localX * sinR + localY * cosR;

    // 3. 平移
    const finalX = rotatedX + this.center.x;
    const finalY = rotatedY + this.center.y;

    return new PointNativeObject(finalX, finalY);
  }

  /**
  * 计算并返回椭圆的两个焦点。
  * @returns {PointNativeObject[]} 包含两个焦点的数组。如果椭圆是圆，则两个焦点重合于圆心。
  */
  public getFoci(): PointNativeObject[] {
    const a = Math.max(this.rx, this.ry);
    const b = Math.min(this.rx, this.ry);

    // 焦距 c^2 = a^2 - b^2
    const c_squared = a * a - b * b;

    // 如果是圆 (c^2接近0)，焦点就是圆心
    if (c_squared < 1e-9) {
      return [this.center, this.center];
    }

    const c = Math.sqrt(c_squared);

    let f1_localX: number, f1_localY: number, f2_localX: number, f2_localY: number;

    // 判断主轴方向
    if (this.rx > this.ry) { // 主轴是X轴
      f1_localX = c; f1_localY = 0;
      f2_localX = -c; f2_localY = 0;
    } else { // 主轴是Y轴
      f1_localX = 0; f1_localY = c;
      f2_localX = 0; f2_localY = -c;
    }

    const f1 = this._getTransformedPoint(f1_localX, f1_localY);
    const f2 = this._getTransformedPoint(f2_localX, f2_localY);

    return [f1, f2];
  }

  /**
  * 计算并返回椭圆的四个顶点（长轴和短轴的端点）。
  * @returns {{major: Point[], minor: Point[]}} 一个包含主轴和次轴顶点的对象。
  */
  public getVertices(): { major: PointNativeObject[], minor: PointNativeObject[] } {
    const a = Math.max(this.rx, this.ry);
    const b = Math.min(this.rx, this.ry);

    let v_major1_localX, v_major1_localY, v_major2_localX, v_major2_localY;
    let v_minor1_localX, v_minor1_localY, v_minor2_localX, v_minor2_localY;

    if (this.rx > this.ry) { // 主轴是X轴
      v_major1_localX = a; v_major1_localY = 0;
      v_major2_localX = -a; v_major2_localY = 0;
      v_minor1_localX = 0; v_minor1_localY = b;
      v_minor2_localX = 0; v_minor2_localY = -b;
    } else { // 主轴是Y轴
      v_major1_localX = 0; v_major1_localY = a;
      v_major2_localX = 0; v_major2_localY = -a;
      v_minor1_localX = b; v_minor1_localY = 0;
      v_minor2_localX = -b; v_minor2_localY = 0;
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
  public getDirectrices(): LinearNativeObject[] {
    const a = Math.max(this.rx, this.ry);
    const b = Math.min(this.rx, this.ry);

    const c_squared = a * a - b * b;
    if (Math.abs(c_squared) < 1e-9) {
      throw new Error("A circle does not have directrices (they are at infinity).");
    }
    const c = Math.sqrt(c_squared);

    // 准线到中心的距离 d = a^2 / c
    const d = (a * a) / c;

    // 定义一个任意长度用于绘制准线
    const lineLength = Math.max(a, b) * 2;

    let p1_d1, p2_d1, p1_d2, p2_d2;

    if (this.rx > this.ry) { // 主轴是X轴, 准线是垂直线 x = d 和 x = -d
      p1_d1 = this._getTransformedPoint(d, -lineLength);
      p2_d1 = this._getTransformedPoint(d, lineLength);
      p1_d2 = this._getTransformedPoint(-d, -lineLength);
      p2_d2 = this._getTransformedPoint(-d, lineLength);
    } else { // 主轴是Y轴, 准线是水平线 y = d 和 y = -d
      p1_d1 = this._getTransformedPoint(-lineLength, d);
      p2_d1 = this._getTransformedPoint(lineLength, d);
      p1_d2 = this._getTransformedPoint(-lineLength, -d);
      p2_d2 = this._getTransformedPoint(lineLength, -d);
    }

    return [new LinearNativeObject(p1_d1, p2_d1), new LinearNativeObject(p1_d2, p2_d2)];
  }

  public randomPointOnEdge(startAngel?: number, endAngle?: number): PointNativeObject {
    // Generate a random angle in the range [0, 360)
    let angle = Math.random() * 360;

    // If startAngle and endAngle are provided, adjust the angle to be within that range
    if (startAngel !== undefined && endAngle !== undefined) {
      if (startAngel > endAngle) {
        throw new Error("startAngle must be less than or equal to endAngle.");
      }
      angle = startAngel + Math.random() * (endAngle - startAngel);
    }

    let realAngle = angle * (Math.PI / 180); // Convert degrees to radians

    // 计算椭圆上的点
    const cosR = Math.cos(this.rotation);
    const sinR = Math.sin(this.rotation);
    const x = this.center.x + this.rx * Math.cos(realAngle) * cosR - this.ry * Math.sin(realAngle) * sinR;
    const y = this.center.y + this.rx * Math.cos(realAngle) * sinR + this.ry * Math.sin(realAngle) * cosR;

    return new PointNativeObject(x, y);
  }

  getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
    // 获取标签的实际尺寸（考虑padding）
    const padding = options.padding || 0;
    const actualTextWidth = textWidth + padding * 2;
    const actualTextHeight = textHeight + padding * 2;

    let labelX = this.center.x;
    let labelY = this.center.y;

    // 根据drawDirection确定标签位置
    if (options.drawDirection) {
      // 计算椭圆在指定方向上的边界距离
      let directionAngle: number;
      let baseDistance: number;

      switch (options.drawDirection) {
        case 'down':
          directionAngle = Math.PI / 2; // 90度
          break;
        case 'up':
          directionAngle = -Math.PI / 2; // -90度
          break;
        case 'left':
          directionAngle = Math.PI; // 180度
          break;
        case 'right':
          directionAngle = 0; // 0度
          break;
        default:
          directionAngle = 0;
      }

      // 计算椭圆在指定方向上的半径（考虑旋转）
      const adjustedAngle = directionAngle - this.rotation;
      const ellipseRadius = this.rx * this.ry / Math.sqrt(
        Math.pow(this.ry * Math.cos(adjustedAngle), 2) +
        Math.pow(this.rx * Math.sin(adjustedAngle), 2)
      );

      // 计算标签距离中心的距离
      const offsetDistance = ellipseRadius + Math.max(actualTextWidth, actualTextHeight) / 2 / transform.scale + 10 / transform.scale;

      // 应用方向偏移
      labelX += Math.cos(directionAngle) * offsetDistance;
      labelY += Math.sin(directionAngle) * offsetDistance;

    } else {
      // 如果没有指定方向，默认放置在椭圆的右上方
      // 选择一个既美观又不容易与其他元素冲突的位置
      let defaultAngle = -Math.PI / 4; // -45度，右上方

      // 如果椭圆有旋转，调整默认角度以适应椭圆的朝向
      if (Math.abs(this.rotation) > 0.1) {
        // 选择长轴方向的右上方
        defaultAngle = this.rotation - Math.PI / 4;
      }

      // 计算椭圆在默认角度方向上的半径
      const adjustedAngle = defaultAngle - this.rotation;
      const ellipseRadius = this.rx * this.ry / Math.sqrt(
        Math.pow(this.ry * Math.cos(adjustedAngle), 2) +
        Math.pow(this.rx * Math.sin(adjustedAngle), 2)
      );

      // 计算标签距离中心的距离
      const offsetDistance = ellipseRadius + Math.max(actualTextWidth, actualTextHeight) / 2 / transform.scale + 10 / transform.scale;

      labelX += Math.cos(defaultAngle) * offsetDistance;
      labelY += Math.sin(defaultAngle) * offsetDistance;
    }

    // 应用变换（逻辑坐标 -> 屏幕坐标）
    return toScreenPoint(labelX, labelY, transform);
  }
}
