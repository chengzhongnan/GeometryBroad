
import { Point, PointNativeObject } from './Point';
import { Circle } from './Circle';
import { Ellipse } from './Ellipse';
import { Polygon, Region, CircularRegion, CurveCircleRegion, Triangle, Rectangle } from './Polygon';
import { Line, Segment, Ray, LinearNativeObject } from './LinearObject';
import { Angle } from './Angle';
import { GeometricObject, type DrawOptions, type IPoint } from './base';
import { Parabola } from './Parabola';
import { Hyperbola } from './Hyperbola';
import { Curve } from './Curve';

export {
    type IPoint,
    type DrawOptions,
    GeometricObject,
    Point,
    Circle,
    Ellipse,
    Polygon,
    Region,
    CircularRegion,
    CurveCircleRegion,
    Line,
    Segment,
    Ray,
    Triangle,
    Rectangle,
    Angle,
    PointNativeObject,
    LinearNativeObject,
    Parabola,
    Hyperbola,
    Curve
}

export interface CustomFunction {
    name: string;
    argCount: number;
    expression: string;
}
