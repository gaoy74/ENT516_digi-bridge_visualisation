/**
 * Cesium - https://github.com/CesiumGS/cesium
 *
 * Copyright 2011-2020 Cesium Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Columbus View (Pat. Pend.)
 *
 * Portions licensed separately.
 * See https://github.com/CesiumGS/cesium/blob/main/LICENSE.md for full licensing details.
 */

define(['exports', './Matrix2-57f130bc', './RuntimeError-1349fdaf', './ComponentDatatype-17ffa790', './when-4bbc8319', './EllipsoidRhumbLine-e39900fb', './GeometryAttribute-48d0e89b', './WebGLConstants-508b9636'], (function (exports, Matrix2, RuntimeError, ComponentDatatype, when, EllipsoidRhumbLine, GeometryAttribute, WebGLConstants) { 'use strict';

    /* This file is automatically rebuilt by the Cesium build process. */
    var earcut_1 = earcut;
    var _default = earcut;

    function earcut(data, holeIndices, dim) {

        dim = dim || 2;

        var hasHoles = holeIndices && holeIndices.length,
            outerLen = hasHoles ? holeIndices[0] * dim : data.length,
            outerNode = linkedList(data, 0, outerLen, dim, true),
            triangles = [];

        if (!outerNode || outerNode.next === outerNode.prev) return triangles;

        var minX, minY, maxX, maxY, x, y, invSize;

        if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);

        // if the shape is not too simple, we'll use z-order curve hash later; calculate polygon bbox
        if (data.length > 80 * dim) {
            minX = maxX = data[0];
            minY = maxY = data[1];

            for (var i = dim; i < outerLen; i += dim) {
                x = data[i];
                y = data[i + 1];
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }

            // minX, minY and invSize are later used to transform coords into integers for z-order calculation
            invSize = Math.max(maxX - minX, maxY - minY);
            invSize = invSize !== 0 ? 1 / invSize : 0;
        }

        earcutLinked(outerNode, triangles, dim, minX, minY, invSize);

        return triangles;
    }

    // create a circular doubly linked list from polygon points in the specified winding order
    function linkedList(data, start, end, dim, clockwise) {
        var i, last;

        if (clockwise === (signedArea(data, start, end, dim) > 0)) {
            for (i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
        } else {
            for (i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
        }

        if (last && equals(last, last.next)) {
            removeNode(last);
            last = last.next;
        }

        return last;
    }

    // eliminate colinear or duplicate points
    function filterPoints(start, end) {
        if (!start) return start;
        if (!end) end = start;

        var p = start,
            again;
        do {
            again = false;

            if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
                removeNode(p);
                p = end = p.prev;
                if (p === p.next) break;
                again = true;

            } else {
                p = p.next;
            }
        } while (again || p !== end);

        return end;
    }

    // main ear slicing loop which triangulates a polygon (given as a linked list)
    function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
        if (!ear) return;

        // interlink polygon nodes in z-order
        if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

        var stop = ear,
            prev, next;

        // iterate through ears, slicing them one by one
        while (ear.prev !== ear.next) {
            prev = ear.prev;
            next = ear.next;

            if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
                // cut off the triangle
                triangles.push(prev.i / dim);
                triangles.push(ear.i / dim);
                triangles.push(next.i / dim);

                removeNode(ear);

                // skipping the next vertex leads to less sliver triangles
                ear = next.next;
                stop = next.next;

                continue;
            }

            ear = next;

            // if we looped through the whole remaining polygon and can't find any more ears
            if (ear === stop) {
                // try filtering points and slicing again
                if (!pass) {
                    earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);

                // if this didn't work, try curing all small self-intersections locally
                } else if (pass === 1) {
                    ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
                    earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);

                // as a last resort, try splitting the remaining polygon into two
                } else if (pass === 2) {
                    splitEarcut(ear, triangles, dim, minX, minY, invSize);
                }

                break;
            }
        }
    }

    // check whether a polygon node forms a valid ear with adjacent nodes
    function isEar(ear) {
        var a = ear.prev,
            b = ear,
            c = ear.next;

        if (area(a, b, c) >= 0) return false; // reflex, can't be an ear

        // now make sure we don't have other points inside the potential ear
        var p = ear.next.next;

        while (p !== ear.prev) {
            if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
                area(p.prev, p, p.next) >= 0) return false;
            p = p.next;
        }

        return true;
    }

    function isEarHashed(ear, minX, minY, invSize) {
        var a = ear.prev,
            b = ear,
            c = ear.next;

        if (area(a, b, c) >= 0) return false; // reflex, can't be an ear

        // triangle bbox; min & max are calculated like this for speed
        var minTX = a.x < b.x ? (a.x < c.x ? a.x : c.x) : (b.x < c.x ? b.x : c.x),
            minTY = a.y < b.y ? (a.y < c.y ? a.y : c.y) : (b.y < c.y ? b.y : c.y),
            maxTX = a.x > b.x ? (a.x > c.x ? a.x : c.x) : (b.x > c.x ? b.x : c.x),
            maxTY = a.y > b.y ? (a.y > c.y ? a.y : c.y) : (b.y > c.y ? b.y : c.y);

        // z-order range for the current triangle bbox;
        var minZ = zOrder(minTX, minTY, minX, minY, invSize),
            maxZ = zOrder(maxTX, maxTY, minX, minY, invSize);

        var p = ear.prevZ,
            n = ear.nextZ;

        // look for points inside the triangle in both directions
        while (p && p.z >= minZ && n && n.z <= maxZ) {
            if (p !== ear.prev && p !== ear.next &&
                pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
                area(p.prev, p, p.next) >= 0) return false;
            p = p.prevZ;

            if (n !== ear.prev && n !== ear.next &&
                pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
                area(n.prev, n, n.next) >= 0) return false;
            n = n.nextZ;
        }

        // look for remaining points in decreasing z-order
        while (p && p.z >= minZ) {
            if (p !== ear.prev && p !== ear.next &&
                pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
                area(p.prev, p, p.next) >= 0) return false;
            p = p.prevZ;
        }

        // look for remaining points in increasing z-order
        while (n && n.z <= maxZ) {
            if (n !== ear.prev && n !== ear.next &&
                pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
                area(n.prev, n, n.next) >= 0) return false;
            n = n.nextZ;
        }

        return true;
    }

    // go through all polygon nodes and cure small local self-intersections
    function cureLocalIntersections(start, triangles, dim) {
        var p = start;
        do {
            var a = p.prev,
                b = p.next.next;

            if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {

                triangles.push(a.i / dim);
                triangles.push(p.i / dim);
                triangles.push(b.i / dim);

                // remove two nodes involved
                removeNode(p);
                removeNode(p.next);

                p = start = b;
            }
            p = p.next;
        } while (p !== start);

        return filterPoints(p);
    }

    // try splitting polygon into two and triangulate them independently
    function splitEarcut(start, triangles, dim, minX, minY, invSize) {
        // look for a valid diagonal that divides the polygon into two
        var a = start;
        do {
            var b = a.next.next;
            while (b !== a.prev) {
                if (a.i !== b.i && isValidDiagonal(a, b)) {
                    // split the polygon in two by the diagonal
                    var c = splitPolygon(a, b);

                    // filter colinear points around the cuts
                    a = filterPoints(a, a.next);
                    c = filterPoints(c, c.next);

                    // run earcut on each half
                    earcutLinked(a, triangles, dim, minX, minY, invSize);
                    earcutLinked(c, triangles, dim, minX, minY, invSize);
                    return;
                }
                b = b.next;
            }
            a = a.next;
        } while (a !== start);
    }

    // link every hole into the outer loop, producing a single-ring polygon without holes
    function eliminateHoles(data, holeIndices, outerNode, dim) {
        var queue = [],
            i, len, start, end, list;

        for (i = 0, len = holeIndices.length; i < len; i++) {
            start = holeIndices[i] * dim;
            end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
            list = linkedList(data, start, end, dim, false);
            if (list === list.next) list.steiner = true;
            queue.push(getLeftmost(list));
        }

        queue.sort(compareX);

        // process holes from left to right
        for (i = 0; i < queue.length; i++) {
            outerNode = eliminateHole(queue[i], outerNode);
            outerNode = filterPoints(outerNode, outerNode.next);
        }

        return outerNode;
    }

    function compareX(a, b) {
        return a.x - b.x;
    }

    // find a bridge between vertices that connects hole with an outer ring and and link it
    function eliminateHole(hole, outerNode) {
        var bridge = findHoleBridge(hole, outerNode);
        if (!bridge) {
            return outerNode;
        }

        var bridgeReverse = splitPolygon(bridge, hole);

        // filter collinear points around the cuts
        var filteredBridge = filterPoints(bridge, bridge.next);
        filterPoints(bridgeReverse, bridgeReverse.next);

        // Check if input node was removed by the filtering
        return outerNode === bridge ? filteredBridge : outerNode;
    }

    // David Eberly's algorithm for finding a bridge between hole and outer polygon
    function findHoleBridge(hole, outerNode) {
        var p = outerNode,
            hx = hole.x,
            hy = hole.y,
            qx = -Infinity,
            m;

        // find a segment intersected by a ray from the hole's leftmost point to the left;
        // segment's endpoint with lesser x will be potential connection point
        do {
            if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
                var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
                if (x <= hx && x > qx) {
                    qx = x;
                    if (x === hx) {
                        if (hy === p.y) return p;
                        if (hy === p.next.y) return p.next;
                    }
                    m = p.x < p.next.x ? p : p.next;
                }
            }
            p = p.next;
        } while (p !== outerNode);

        if (!m) return null;

        if (hx === qx) return m; // hole touches outer segment; pick leftmost endpoint

        // look for points inside the triangle of hole point, segment intersection and endpoint;
        // if there are no points found, we have a valid connection;
        // otherwise choose the point of the minimum angle with the ray as connection point

        var stop = m,
            mx = m.x,
            my = m.y,
            tanMin = Infinity,
            tan;

        p = m;

        do {
            if (hx >= p.x && p.x >= mx && hx !== p.x &&
                    pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {

                tan = Math.abs(hy - p.y) / (hx - p.x); // tangential

                if (locallyInside(p, hole) &&
                    (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
                    m = p;
                    tanMin = tan;
                }
            }

            p = p.next;
        } while (p !== stop);

        return m;
    }

    // whether sector in vertex m contains sector in vertex p in the same coordinates
    function sectorContainsSector(m, p) {
        return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
    }

    // interlink polygon nodes in z-order
    function indexCurve(start, minX, minY, invSize) {
        var p = start;
        do {
            if (p.z === null) p.z = zOrder(p.x, p.y, minX, minY, invSize);
            p.prevZ = p.prev;
            p.nextZ = p.next;
            p = p.next;
        } while (p !== start);

        p.prevZ.nextZ = null;
        p.prevZ = null;

        sortLinked(p);
    }

    // Simon Tatham's linked list merge sort algorithm
    // http://www.chiark.greenend.org.uk/~sgtatham/algorithms/listsort.html
    function sortLinked(list) {
        var i, p, q, e, tail, numMerges, pSize, qSize,
            inSize = 1;

        do {
            p = list;
            list = null;
            tail = null;
            numMerges = 0;

            while (p) {
                numMerges++;
                q = p;
                pSize = 0;
                for (i = 0; i < inSize; i++) {
                    pSize++;
                    q = q.nextZ;
                    if (!q) break;
                }
                qSize = inSize;

                while (pSize > 0 || (qSize > 0 && q)) {

                    if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
                        e = p;
                        p = p.nextZ;
                        pSize--;
                    } else {
                        e = q;
                        q = q.nextZ;
                        qSize--;
                    }

                    if (tail) tail.nextZ = e;
                    else list = e;

                    e.prevZ = tail;
                    tail = e;
                }

                p = q;
            }

            tail.nextZ = null;
            inSize *= 2;

        } while (numMerges > 1);

        return list;
    }

    // z-order of a point given coords and inverse of the longer side of data bbox
    function zOrder(x, y, minX, minY, invSize) {
        // coords are transformed into non-negative 15-bit integer range
        x = 32767 * (x - minX) * invSize;
        y = 32767 * (y - minY) * invSize;

        x = (x | (x << 8)) & 0x00FF00FF;
        x = (x | (x << 4)) & 0x0F0F0F0F;
        x = (x | (x << 2)) & 0x33333333;
        x = (x | (x << 1)) & 0x55555555;

        y = (y | (y << 8)) & 0x00FF00FF;
        y = (y | (y << 4)) & 0x0F0F0F0F;
        y = (y | (y << 2)) & 0x33333333;
        y = (y | (y << 1)) & 0x55555555;

        return x | (y << 1);
    }

    // find the leftmost node of a polygon ring
    function getLeftmost(start) {
        var p = start,
            leftmost = start;
        do {
            if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
            p = p.next;
        } while (p !== start);

        return leftmost;
    }

    // check if a point lies within a convex triangle
    function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
        return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
               (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
               (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
    }

    // check if a diagonal between two polygon nodes is valid (lies in polygon interior)
    function isValidDiagonal(a, b) {
        return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && // dones't intersect other edges
               (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && // locally visible
                (area(a.prev, a, b.prev) || area(a, b.prev, b)) || // does not create opposite-facing sectors
                equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0); // special zero-length case
    }

    // signed area of a triangle
    function area(p, q, r) {
        return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    }

    // check if two points are equal
    function equals(p1, p2) {
        return p1.x === p2.x && p1.y === p2.y;
    }

    // check if two segments intersect
    function intersects(p1, q1, p2, q2) {
        var o1 = sign(area(p1, q1, p2));
        var o2 = sign(area(p1, q1, q2));
        var o3 = sign(area(p2, q2, p1));
        var o4 = sign(area(p2, q2, q1));

        if (o1 !== o2 && o3 !== o4) return true; // general case

        if (o1 === 0 && onSegment(p1, p2, q1)) return true; // p1, q1 and p2 are collinear and p2 lies on p1q1
        if (o2 === 0 && onSegment(p1, q2, q1)) return true; // p1, q1 and q2 are collinear and q2 lies on p1q1
        if (o3 === 0 && onSegment(p2, p1, q2)) return true; // p2, q2 and p1 are collinear and p1 lies on p2q2
        if (o4 === 0 && onSegment(p2, q1, q2)) return true; // p2, q2 and q1 are collinear and q1 lies on p2q2

        return false;
    }

    // for collinear points p, q, r, check if point q lies on segment pr
    function onSegment(p, q, r) {
        return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
    }

    function sign(num) {
        return num > 0 ? 1 : num < 0 ? -1 : 0;
    }

    // check if a polygon diagonal intersects any polygon segments
    function intersectsPolygon(a, b) {
        var p = a;
        do {
            if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
                    intersects(p, p.next, a, b)) return true;
            p = p.next;
        } while (p !== a);

        return false;
    }

    // check if a polygon diagonal is locally inside the polygon
    function locallyInside(a, b) {
        return area(a.prev, a, a.next) < 0 ?
            area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
            area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
    }

    // check if the middle point of a polygon diagonal is inside the polygon
    function middleInside(a, b) {
        var p = a,
            inside = false,
            px = (a.x + b.x) / 2,
            py = (a.y + b.y) / 2;
        do {
            if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
                    (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x))
                inside = !inside;
            p = p.next;
        } while (p !== a);

        return inside;
    }

    // link two polygon vertices with a bridge; if the vertices belong to the same ring, it splits polygon into two;
    // if one belongs to the outer ring and another to a hole, it merges it into a single ring
    function splitPolygon(a, b) {
        var a2 = new Node(a.i, a.x, a.y),
            b2 = new Node(b.i, b.x, b.y),
            an = a.next,
            bp = b.prev;

        a.next = b;
        b.prev = a;

        a2.next = an;
        an.prev = a2;

        b2.next = a2;
        a2.prev = b2;

        bp.next = b2;
        b2.prev = bp;

        return b2;
    }

    // create a node and optionally link it with previous one (in a circular doubly linked list)
    function insertNode(i, x, y, last) {
        var p = new Node(i, x, y);

        if (!last) {
            p.prev = p;
            p.next = p;

        } else {
            p.next = last.next;
            p.prev = last;
            last.next.prev = p;
            last.next = p;
        }
        return p;
    }

    function removeNode(p) {
        p.next.prev = p.prev;
        p.prev.next = p.next;

        if (p.prevZ) p.prevZ.nextZ = p.nextZ;
        if (p.nextZ) p.nextZ.prevZ = p.prevZ;
    }

    function Node(i, x, y) {
        // vertex index in coordinates array
        this.i = i;

        // vertex coordinates
        this.x = x;
        this.y = y;

        // previous and next vertex nodes in a polygon ring
        this.prev = null;
        this.next = null;

        // z-order curve value
        this.z = null;

        // previous and next nodes in z-order
        this.prevZ = null;
        this.nextZ = null;

        // indicates whether this is a steiner point
        this.steiner = false;
    }

    // return a percentage difference between the polygon area and its triangulation area;
    // used to verify correctness of triangulation
    earcut.deviation = function (data, holeIndices, dim, triangles) {
        var hasHoles = holeIndices && holeIndices.length;
        var outerLen = hasHoles ? holeIndices[0] * dim : data.length;

        var polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
        if (hasHoles) {
            for (var i = 0, len = holeIndices.length; i < len; i++) {
                var start = holeIndices[i] * dim;
                var end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
                polygonArea -= Math.abs(signedArea(data, start, end, dim));
            }
        }

        var trianglesArea = 0;
        for (i = 0; i < triangles.length; i += 3) {
            var a = triangles[i] * dim;
            var b = triangles[i + 1] * dim;
            var c = triangles[i + 2] * dim;
            trianglesArea += Math.abs(
                (data[a] - data[c]) * (data[b + 1] - data[a + 1]) -
                (data[a] - data[b]) * (data[c + 1] - data[a + 1]));
        }

        return polygonArea === 0 && trianglesArea === 0 ? 0 :
            Math.abs((trianglesArea - polygonArea) / polygonArea);
    };

    function signedArea(data, start, end, dim) {
        var sum = 0;
        for (var i = start, j = end - dim; i < end; i += dim) {
            sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
            j = i;
        }
        return sum;
    }

    // turn a polygon in a multi-dimensional array form (e.g. as in GeoJSON) into a form Earcut accepts
    earcut.flatten = function (data) {
        var dim = data[0][0].length,
            result = {vertices: [], holes: [], dimensions: dim},
            holeIndex = 0;

        for (var i = 0; i < data.length; i++) {
            for (var j = 0; j < data[i].length; j++) {
                for (var d = 0; d < dim; d++) result.vertices.push(data[i][j][d]);
            }
            if (i > 0) {
                holeIndex += data[i - 1].length;
                result.holes.push(holeIndex);
            }
        }
        return result;
    };
    earcut_1.default = _default;

    /**
     * Winding order defines the order of vertices for a triangle to be considered front-facing.
     *
     * @enum {Number}
     */
    const WindingOrder = {
      /**
       * Vertices are in clockwise order.
       *
       * @type {Number}
       * @constant
       */
      CLOCKWISE: WebGLConstants.WebGLConstants.CW,

      /**
       * Vertices are in counter-clockwise order.
       *
       * @type {Number}
       * @constant
       */
      COUNTER_CLOCKWISE: WebGLConstants.WebGLConstants.CCW,
    };

    /**
     * @private
     */
    WindingOrder.validate = function (windingOrder) {
      return (
        windingOrder === WindingOrder.CLOCKWISE ||
        windingOrder === WindingOrder.COUNTER_CLOCKWISE
      );
    };

    var WindingOrder$1 = Object.freeze(WindingOrder);

    const scaleToGeodeticHeightN = new Matrix2.Cartesian3();
    const scaleToGeodeticHeightP = new Matrix2.Cartesian3();

    /**
     * @private
     */
    const PolygonPipeline = {};

    /**
     * @exception {DeveloperError} At least three positions are required.
     */
    PolygonPipeline.computeArea2D = function (positions) {
      //>>includeStart('debug', pragmas.debug);
      RuntimeError.Check.defined("positions", positions);
      RuntimeError.Check.typeOf.number.greaterThanOrEquals(
        "positions.length",
        positions.length,
        3
      );
      //>>includeEnd('debug');

      const length = positions.length;
      let area = 0.0;

      for (let i0 = length - 1, i1 = 0; i1 < length; i0 = i1++) {
        const v0 = positions[i0];
        const v1 = positions[i1];

        area += v0.x * v1.y - v1.x * v0.y;
      }

      return area * 0.5;
    };

    /**
     * @returns {WindingOrder} The winding order.
     *
     * @exception {DeveloperError} At least three positions are required.
     */
    PolygonPipeline.computeWindingOrder2D = function (positions) {
      const area = PolygonPipeline.computeArea2D(positions);
      return area > 0.0 ? WindingOrder$1.COUNTER_CLOCKWISE : WindingOrder$1.CLOCKWISE;
    };

    /**
     * Triangulate a polygon.
     *
     * @param {Cartesian2[]} positions Cartesian2 array containing the vertices of the polygon
     * @param {Number[]} [holes] An array of the staring indices of the holes.
     * @returns {Number[]} Index array representing triangles that fill the polygon
     */
    PolygonPipeline.triangulate = function (positions, holes) {
      //>>includeStart('debug', pragmas.debug);
      RuntimeError.Check.defined("positions", positions);
      //>>includeEnd('debug');

      const flattenedPositions = Matrix2.Cartesian2.packArray(positions);
      return earcut_1(flattenedPositions, holes, 2);
    };

    const subdivisionV0Scratch = new Matrix2.Cartesian3();
    const subdivisionV1Scratch = new Matrix2.Cartesian3();
    const subdivisionV2Scratch = new Matrix2.Cartesian3();
    const subdivisionS0Scratch = new Matrix2.Cartesian3();
    const subdivisionS1Scratch = new Matrix2.Cartesian3();
    const subdivisionS2Scratch = new Matrix2.Cartesian3();
    const subdivisionMidScratch = new Matrix2.Cartesian3();

    /**
     * Subdivides positions and raises points to the surface of the ellipsoid.
     *
     * @param {Ellipsoid} ellipsoid The ellipsoid the polygon in on.
     * @param {Cartesian3[]} positions An array of {@link Cartesian3} positions of the polygon.
     * @param {Number[]} indices An array of indices that determines the triangles in the polygon.
     * @param {Number} [granularity=CesiumMath.RADIANS_PER_DEGREE] The distance, in radians, between each latitude and longitude. Determines the number of positions in the buffer.
     *
     * @exception {DeveloperError} At least three indices are required.
     * @exception {DeveloperError} The number of indices must be divisable by three.
     * @exception {DeveloperError} Granularity must be greater than zero.
     */
    PolygonPipeline.computeSubdivision = function (
      ellipsoid,
      positions,
      indices,
      granularity
    ) {
      granularity = when.defaultValue(granularity, ComponentDatatype.CesiumMath.RADIANS_PER_DEGREE);

      //>>includeStart('debug', pragmas.debug);
      RuntimeError.Check.typeOf.object("ellipsoid", ellipsoid);
      RuntimeError.Check.defined("positions", positions);
      RuntimeError.Check.defined("indices", indices);
      RuntimeError.Check.typeOf.number.greaterThanOrEquals("indices.length", indices.length, 3);
      RuntimeError.Check.typeOf.number.equals("indices.length % 3", "0", indices.length % 3, 0);
      RuntimeError.Check.typeOf.number.greaterThan("granularity", granularity, 0.0);
      //>>includeEnd('debug');

      // triangles that need (or might need) to be subdivided.
      const triangles = indices.slice(0);

      // New positions due to edge splits are appended to the positions list.
      let i;
      const length = positions.length;
      const subdividedPositions = new Array(length * 3);
      let q = 0;
      for (i = 0; i < length; i++) {
        const item = positions[i];
        subdividedPositions[q++] = item.x;
        subdividedPositions[q++] = item.y;
        subdividedPositions[q++] = item.z;
      }

      const subdividedIndices = [];

      // Used to make sure shared edges are not split more than once.
      const edges = {};

      const radius = ellipsoid.maximumRadius;
      const minDistance = ComponentDatatype.CesiumMath.chordLength(granularity, radius);
      const minDistanceSqrd = minDistance * minDistance;

      while (triangles.length > 0) {
        const i2 = triangles.pop();
        const i1 = triangles.pop();
        const i0 = triangles.pop();

        const v0 = Matrix2.Cartesian3.fromArray(
          subdividedPositions,
          i0 * 3,
          subdivisionV0Scratch
        );
        const v1 = Matrix2.Cartesian3.fromArray(
          subdividedPositions,
          i1 * 3,
          subdivisionV1Scratch
        );
        const v2 = Matrix2.Cartesian3.fromArray(
          subdividedPositions,
          i2 * 3,
          subdivisionV2Scratch
        );

        const s0 = Matrix2.Cartesian3.multiplyByScalar(
          Matrix2.Cartesian3.normalize(v0, subdivisionS0Scratch),
          radius,
          subdivisionS0Scratch
        );
        const s1 = Matrix2.Cartesian3.multiplyByScalar(
          Matrix2.Cartesian3.normalize(v1, subdivisionS1Scratch),
          radius,
          subdivisionS1Scratch
        );
        const s2 = Matrix2.Cartesian3.multiplyByScalar(
          Matrix2.Cartesian3.normalize(v2, subdivisionS2Scratch),
          radius,
          subdivisionS2Scratch
        );

        const g0 = Matrix2.Cartesian3.magnitudeSquared(
          Matrix2.Cartesian3.subtract(s0, s1, subdivisionMidScratch)
        );
        const g1 = Matrix2.Cartesian3.magnitudeSquared(
          Matrix2.Cartesian3.subtract(s1, s2, subdivisionMidScratch)
        );
        const g2 = Matrix2.Cartesian3.magnitudeSquared(
          Matrix2.Cartesian3.subtract(s2, s0, subdivisionMidScratch)
        );

        const max = Math.max(g0, g1, g2);
        let edge;
        let mid;

        // if the max length squared of a triangle edge is greater than the chord length of squared
        // of the granularity, subdivide the triangle
        if (max > minDistanceSqrd) {
          if (g0 === max) {
            edge = Math.min(i0, i1) + " " + Math.max(i0, i1);

            i = edges[edge];
            if (!when.defined(i)) {
              mid = Matrix2.Cartesian3.add(v0, v1, subdivisionMidScratch);
              Matrix2.Cartesian3.multiplyByScalar(mid, 0.5, mid);
              subdividedPositions.push(mid.x, mid.y, mid.z);
              i = subdividedPositions.length / 3 - 1;
              edges[edge] = i;
            }

            triangles.push(i0, i, i2);
            triangles.push(i, i1, i2);
          } else if (g1 === max) {
            edge = Math.min(i1, i2) + " " + Math.max(i1, i2);

            i = edges[edge];
            if (!when.defined(i)) {
              mid = Matrix2.Cartesian3.add(v1, v2, subdivisionMidScratch);
              Matrix2.Cartesian3.multiplyByScalar(mid, 0.5, mid);
              subdividedPositions.push(mid.x, mid.y, mid.z);
              i = subdividedPositions.length / 3 - 1;
              edges[edge] = i;
            }

            triangles.push(i1, i, i0);
            triangles.push(i, i2, i0);
          } else if (g2 === max) {
            edge = Math.min(i2, i0) + " " + Math.max(i2, i0);

            i = edges[edge];
            if (!when.defined(i)) {
              mid = Matrix2.Cartesian3.add(v2, v0, subdivisionMidScratch);
              Matrix2.Cartesian3.multiplyByScalar(mid, 0.5, mid);
              subdividedPositions.push(mid.x, mid.y, mid.z);
              i = subdividedPositions.length / 3 - 1;
              edges[edge] = i;
            }

            triangles.push(i2, i, i1);
            triangles.push(i, i0, i1);
          }
        } else {
          subdividedIndices.push(i0);
          subdividedIndices.push(i1);
          subdividedIndices.push(i2);
        }
      }

      return new GeometryAttribute.Geometry({
        attributes: {
          position: new GeometryAttribute.GeometryAttribute({
            componentDatatype: ComponentDatatype.ComponentDatatype.DOUBLE,
            componentsPerAttribute: 3,
            values: subdividedPositions,
          }),
        },
        indices: subdividedIndices,
        primitiveType: GeometryAttribute.PrimitiveType.TRIANGLES,
      });
    };

    const subdivisionC0Scratch = new Matrix2.Cartographic();
    const subdivisionC1Scratch = new Matrix2.Cartographic();
    const subdivisionC2Scratch = new Matrix2.Cartographic();
    const subdivisionCartographicScratch = new Matrix2.Cartographic();

    /**
     * Subdivides positions on rhumb lines and raises points to the surface of the ellipsoid.
     *
     * @param {Ellipsoid} ellipsoid The ellipsoid the polygon in on.
     * @param {Cartesian3[]} positions An array of {@link Cartesian3} positions of the polygon.
     * @param {Number[]} indices An array of indices that determines the triangles in the polygon.
     * @param {Number} [granularity=CesiumMath.RADIANS_PER_DEGREE] The distance, in radians, between each latitude and longitude. Determines the number of positions in the buffer.
     *
     * @exception {DeveloperError} At least three indices are required.
     * @exception {DeveloperError} The number of indices must be divisable by three.
     * @exception {DeveloperError} Granularity must be greater than zero.
     */
    PolygonPipeline.computeRhumbLineSubdivision = function (
      ellipsoid,
      positions,
      indices,
      granularity
    ) {
      granularity = when.defaultValue(granularity, ComponentDatatype.CesiumMath.RADIANS_PER_DEGREE);

      //>>includeStart('debug', pragmas.debug);
      RuntimeError.Check.typeOf.object("ellipsoid", ellipsoid);
      RuntimeError.Check.defined("positions", positions);
      RuntimeError.Check.defined("indices", indices);
      RuntimeError.Check.typeOf.number.greaterThanOrEquals("indices.length", indices.length, 3);
      RuntimeError.Check.typeOf.number.equals("indices.length % 3", "0", indices.length % 3, 0);
      RuntimeError.Check.typeOf.number.greaterThan("granularity", granularity, 0.0);
      //>>includeEnd('debug');

      // triangles that need (or might need) to be subdivided.
      const triangles = indices.slice(0);

      // New positions due to edge splits are appended to the positions list.
      let i;
      const length = positions.length;
      const subdividedPositions = new Array(length * 3);
      let q = 0;
      for (i = 0; i < length; i++) {
        const item = positions[i];
        subdividedPositions[q++] = item.x;
        subdividedPositions[q++] = item.y;
        subdividedPositions[q++] = item.z;
      }

      const subdividedIndices = [];

      // Used to make sure shared edges are not split more than once.
      const edges = {};

      const radius = ellipsoid.maximumRadius;
      const minDistance = ComponentDatatype.CesiumMath.chordLength(granularity, radius);

      const rhumb0 = new EllipsoidRhumbLine.EllipsoidRhumbLine(undefined, undefined, ellipsoid);
      const rhumb1 = new EllipsoidRhumbLine.EllipsoidRhumbLine(undefined, undefined, ellipsoid);
      const rhumb2 = new EllipsoidRhumbLine.EllipsoidRhumbLine(undefined, undefined, ellipsoid);

      while (triangles.length > 0) {
        const i2 = triangles.pop();
        const i1 = triangles.pop();
        const i0 = triangles.pop();

        const v0 = Matrix2.Cartesian3.fromArray(
          subdividedPositions,
          i0 * 3,
          subdivisionV0Scratch
        );
        const v1 = Matrix2.Cartesian3.fromArray(
          subdividedPositions,
          i1 * 3,
          subdivisionV1Scratch
        );
        const v2 = Matrix2.Cartesian3.fromArray(
          subdividedPositions,
          i2 * 3,
          subdivisionV2Scratch
        );

        const c0 = ellipsoid.cartesianToCartographic(v0, subdivisionC0Scratch);
        const c1 = ellipsoid.cartesianToCartographic(v1, subdivisionC1Scratch);
        const c2 = ellipsoid.cartesianToCartographic(v2, subdivisionC2Scratch);

        rhumb0.setEndPoints(c0, c1);
        const g0 = rhumb0.surfaceDistance;
        rhumb1.setEndPoints(c1, c2);
        const g1 = rhumb1.surfaceDistance;
        rhumb2.setEndPoints(c2, c0);
        const g2 = rhumb2.surfaceDistance;

        const max = Math.max(g0, g1, g2);
        let edge;
        let mid;
        let midHeight;
        let midCartesian3;

        // if the max length squared of a triangle edge is greater than granularity, subdivide the triangle
        if (max > minDistance) {
          if (g0 === max) {
            edge = Math.min(i0, i1) + " " + Math.max(i0, i1);

            i = edges[edge];
            if (!when.defined(i)) {
              mid = rhumb0.interpolateUsingFraction(
                0.5,
                subdivisionCartographicScratch
              );
              midHeight = (c0.height + c1.height) * 0.5;
              midCartesian3 = Matrix2.Cartesian3.fromRadians(
                mid.longitude,
                mid.latitude,
                midHeight,
                ellipsoid,
                subdivisionMidScratch
              );
              subdividedPositions.push(
                midCartesian3.x,
                midCartesian3.y,
                midCartesian3.z
              );
              i = subdividedPositions.length / 3 - 1;
              edges[edge] = i;
            }

            triangles.push(i0, i, i2);
            triangles.push(i, i1, i2);
          } else if (g1 === max) {
            edge = Math.min(i1, i2) + " " + Math.max(i1, i2);

            i = edges[edge];
            if (!when.defined(i)) {
              mid = rhumb1.interpolateUsingFraction(
                0.5,
                subdivisionCartographicScratch
              );
              midHeight = (c1.height + c2.height) * 0.5;
              midCartesian3 = Matrix2.Cartesian3.fromRadians(
                mid.longitude,
                mid.latitude,
                midHeight,
                ellipsoid,
                subdivisionMidScratch
              );
              subdividedPositions.push(
                midCartesian3.x,
                midCartesian3.y,
                midCartesian3.z
              );
              i = subdividedPositions.length / 3 - 1;
              edges[edge] = i;
            }

            triangles.push(i1, i, i0);
            triangles.push(i, i2, i0);
          } else if (g2 === max) {
            edge = Math.min(i2, i0) + " " + Math.max(i2, i0);

            i = edges[edge];
            if (!when.defined(i)) {
              mid = rhumb2.interpolateUsingFraction(
                0.5,
                subdivisionCartographicScratch
              );
              midHeight = (c2.height + c0.height) * 0.5;
              midCartesian3 = Matrix2.Cartesian3.fromRadians(
                mid.longitude,
                mid.latitude,
                midHeight,
                ellipsoid,
                subdivisionMidScratch
              );
              subdividedPositions.push(
                midCartesian3.x,
                midCartesian3.y,
                midCartesian3.z
              );
              i = subdividedPositions.length / 3 - 1;
              edges[edge] = i;
            }

            triangles.push(i2, i, i1);
            triangles.push(i, i0, i1);
          }
        } else {
          subdividedIndices.push(i0);
          subdividedIndices.push(i1);
          subdividedIndices.push(i2);
        }
      }

      return new GeometryAttribute.Geometry({
        attributes: {
          position: new GeometryAttribute.GeometryAttribute({
            componentDatatype: ComponentDatatype.ComponentDatatype.DOUBLE,
            componentsPerAttribute: 3,
            values: subdividedPositions,
          }),
        },
        indices: subdividedIndices,
        primitiveType: GeometryAttribute.PrimitiveType.TRIANGLES,
      });
    };

    /**
     * Scales each position of a geometry's position attribute to a height, in place.
     *
     * @param {Number[]} positions The array of numbers representing the positions to be scaled
     * @param {Number} [height=0.0] The desired height to add to the positions
     * @param {Ellipsoid} [ellipsoid=Ellipsoid.WGS84] The ellipsoid on which the positions lie.
     * @param {Boolean} [scaleToSurface=true] <code>true</code> if the positions need to be scaled to the surface before the height is added.
     * @returns {Number[]} The input array of positions, scaled to height
     */
    PolygonPipeline.scaleToGeodeticHeight = function (
      positions,
      height,
      ellipsoid,
      scaleToSurface
    ) {
      ellipsoid = when.defaultValue(ellipsoid, Matrix2.Ellipsoid.WGS84);

      let n = scaleToGeodeticHeightN;
      let p = scaleToGeodeticHeightP;

      height = when.defaultValue(height, 0.0);
      scaleToSurface = when.defaultValue(scaleToSurface, true);

      if (when.defined(positions)) {
        const length = positions.length;

        for (let i = 0; i < length; i += 3) {
          Matrix2.Cartesian3.fromArray(positions, i, p);

          if (scaleToSurface) {
            p = ellipsoid.scaleToGeodeticSurface(p, p);
          }

          if (height !== 0) {
            n = ellipsoid.geodeticSurfaceNormal(p, n);

            Matrix2.Cartesian3.multiplyByScalar(n, height, n);
            Matrix2.Cartesian3.add(p, n, p);
          }

          positions[i] = p.x;
          positions[i + 1] = p.y;
          positions[i + 2] = p.z;
        }
      }

      return positions;
    };

    exports.PolygonPipeline = PolygonPipeline;
    exports.WindingOrder = WindingOrder$1;

}));
//# sourceMappingURL=PolygonPipeline-e572789b.js.map