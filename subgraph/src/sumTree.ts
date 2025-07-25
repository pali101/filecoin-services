import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { SumTreeCount } from "../generated/schema";

// Define a class for the structure instead of a type alias
class PieceIdAndOffset {
  pieceId: BigInt; // Keeping field name for compatibility with existing usage
  offset: BigInt;
}

export class SumTree {
  private getPieceEntityId(setId: BigInt, pieceId: BigInt): Bytes {
    return Bytes.fromUTF8(setId.toString() + "-" + pieceId.toString());
  }

  // Helper: Get sumTreeCounts[setId][index], default 0
  private getSum(setId: i32, index: i32, blockNumber: BigInt): BigInt {
    const pieceEntityId = this.getPieceEntityId(
      BigInt.fromI32(setId as i32),
      BigInt.fromI32(index as i32)
    );
    const sumTreeCount = SumTreeCount.load(pieceEntityId);
    if (!sumTreeCount) return BigInt.fromI32(0);
    if (sumTreeCount.lastDecEpoch.equals(blockNumber)) {
      return sumTreeCount.lastCount;
    }
    return sumTreeCount.count;
  }

  // Helper: Set sumTreeCounts[setId][index] = value
  private setSum(setId: i32, index: i32, value: BigInt): void {
    const pieceEntityId = this.getPieceEntityId(
      BigInt.fromI32(setId),
      BigInt.fromI32(index)
    );
    const sumTreeCount = new SumTreeCount(pieceEntityId);
    sumTreeCount.setId = BigInt.fromI32(setId as i32);
    sumTreeCount.pieceId = BigInt.fromI32(index as i32);
    sumTreeCount.count = value;
    sumTreeCount.lastCount = BigInt.fromI32(0);
    sumTreeCount.lastDecEpoch = BigInt.fromI32(0);
    sumTreeCount.save();
  }

  // Helper: Decrement sumTreeCounts[setId][index] by delta
  private decSum(
    setId: i32,
    index: i32,
    delta: BigInt,
    blockNumber: BigInt
  ): void {
    const pieceEntityId = this.getPieceEntityId(
      BigInt.fromI32(setId),
      BigInt.fromI32(index)
    );
    const sumTreeCount = SumTreeCount.load(pieceEntityId);
    if (!sumTreeCount) return;
    const prev = sumTreeCount.count;
    sumTreeCount.lastCount = prev;
    sumTreeCount.count = prev.minus(delta);
    sumTreeCount.lastDecEpoch = blockNumber;
    sumTreeCount.save();
  }

  // Helper: heightFromIndex (number of trailing zeros in index+1)
  private heightFromIndex(index: i32): i32 {
    let x = index + 1;
    let tz = 0;
    while ((x & 1) === 0) {
      tz++;
      x >>= 1;
    }
    return tz;
  }

  // Helper: clz (count leading zeros) for 32-bit numbers
  private clz(x: i32): i32 {
    if (x === 0) return 32;
    let n = 32;
    let y = (x as u32) >> 16;
    if (y !== 0) {
      n -= 16;
      x = y;
    }
    y = (x as u32) >> 8;
    if (y !== 0) {
      n -= 8;
      x = y;
    }
    y = (x as u32) >> 4;
    if (y !== 0) {
      n -= 4;
      x = y;
    }
    y = (x as u32) >> 2;
    if (y !== 0) {
      n -= 2;
      x = y;
    }
    y = (x as u32) >> 1;
    if (y !== 0) {
      return n - 2;
    }
    return n - (x as i32);
  }

  // sumTreeAdd
  sumTreeAdd(setId: i32, count: BigInt, pieceId: i32): void {
    let index = pieceId;
    let h = this.heightFromIndex(index);
    let sum = count;
    for (let i = 0; i < h; i++) {
      let j = index - (1 << i);
      sum = sum.plus(this.getSum(setId, j, BigInt.fromI32(1))); // 0 is default value of lastDecEpoch so using 1
    }
    this.setSum(setId, pieceId, sum);
  }

  // sumTreeRemove
  sumTreeRemove(
    setId: i32,
    nextPiece: i32,
    index: i32,
    delta: BigInt,
    blockNumber: BigInt
  ): void {
    const top = 32 - this.clz(nextPiece);
    let h = this.heightFromIndex(index);
    while (h <= top && index < nextPiece) {
      this.decSum(setId, index, delta, blockNumber);
      index += 1 << h;
      h = this.heightFromIndex(index);
    }
  }

  // findOnePieceId
  findOnePieceId(
    setId: i32,
    nextPiece: i32,
    leafIndex: BigInt,
    top: i32,
    blockNumber: BigInt
  ): PieceIdAndOffset {
    let searchPtr = (1 << top) - 1;
    let acc: BigInt = BigInt.fromI32(0);
    let candidate: BigInt = BigInt.fromI32(0);
    for (let h = top; h > 0; h--) {
      if (searchPtr >= nextPiece) {
        searchPtr -= 1 << (h - 1);
        continue;
      }
      const sum = this.getSum(setId, searchPtr, blockNumber);
      candidate = acc.plus(sum);
      if (candidate.le(leafIndex)) {
        acc = acc.plus(sum);
        searchPtr += 1 << (h - 1);
      } else {
        searchPtr -= 1 << (h - 1);
      }
    }
    candidate = acc.plus(this.getSum(setId, searchPtr, blockNumber));
    if (candidate.le(leafIndex)) {
      return {
        pieceId: BigInt.fromI32(searchPtr + 1), // Keeping field name for compatibility
        offset: leafIndex.minus(candidate)
      };
    }
    return {
      pieceId: BigInt.fromI32(searchPtr), // Keeping field name for compatibility
      offset: leafIndex.minus(acc)
    };
  }

  // findPieceIds (batched) - keeping method name for compatibility
  findPieceIds(
    setId: i32,
    nextPieceId: i32,
    leafIndexes: BigInt[],
    blockNumber: BigInt
  ): PieceIdAndOffset[] {
    const top = 32 - this.clz(nextPieceId);

    const results: PieceIdAndOffset[] = [];
    for (let i = 0; i < leafIndexes.length; i++) {
      const idx = leafIndexes[i];

      const result = this.findOnePieceId(
        setId,
        nextPieceId,
        idx,
        top,
        blockNumber
      );
      results.push(result);
    }

    return results;
  }
}

export default SumTree;
