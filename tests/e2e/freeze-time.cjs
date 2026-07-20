const fixedNow = Date.parse(process.env.PLAYWRIGHT_NOW ?? "2026-07-20T00:10:00.000Z");
if (!Number.isFinite(fixedNow)) throw new Error(`Invalid PLAYWRIGHT_NOW: ${process.env.PLAYWRIGHT_NOW}`);

const RealDate = Date;

class FrozenDate extends RealDate {
  constructor(...args) {
    super(...(args.length === 0 ? [fixedNow] : args));
  }

  static now() {
    return fixedNow;
  }
}

FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
global.Date = FrozenDate;
