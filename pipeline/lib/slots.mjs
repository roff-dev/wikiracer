// Packs items (lists or title entries) into fixed-size slots: items
// go into the current group while they fit; a group is padded with zeros to the end of its slot;
// an item longer than one slot starts a new group by itself and takes ceil(bytes / slotBytes)
// consecutive slots. The sink receives the bytes in order: sink.write(bytes) and sink.pad(n).
export class SlotPacker {
  constructor(sink, slotBytes) {
    this.sink = sink;
    this.slotBytes = slotBytes;
    this.cur = 0; // bytes in the open group
    this.groupFirst = 0; // id of the first item in the open group
    this.next = 0; // id of the next item
    this.firstOfSlot = []; // per slot, the id of the first item of the group it belongs to
  }

  add(bytes) {
    if (this.cur > 0 && this.cur + bytes.length > this.slotBytes) this.close();
    if (this.cur === 0) this.groupFirst = this.next;
    this.sink.write(bytes);
    this.cur += bytes.length;
    this.next++;
  }

  close() {
    const slots = Math.max(1, Math.ceil(this.cur / this.slotBytes));
    this.sink.pad(slots * this.slotBytes - this.cur);
    for (let k = 0; k < slots; k++) this.firstOfSlot.push(this.groupFirst);
    this.cur = 0;
  }

  // Closes the last group. Returns per-slot first ids.
  finish() {
    if (this.cur > 0 || this.firstOfSlot.length === 0) this.close();
    return this.firstOfSlot;
  }
}

// The slot index body (before gzip): per slot, its first id as a varint delta from the previous
// slot's; the first value is absolute and 0 marks a continuation slot.
export function slotIndexDeltas(firstOfSlot) {
  return firstOfSlot.map((f, i) => (i === 0 ? f : f - firstOfSlot[i - 1]));
}
