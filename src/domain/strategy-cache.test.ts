import {describe,it,expect} from "vitest";
import {StrategyCache} from "./strategy-cache";
describe("session calculation cache",()=>{
  it("reuses results and evicts least recently used entries",()=>{
    const cache=new StrategyCache<number>(2,1000);
    cache.set("a",1);cache.set("b",2);expect(cache.get("a")).toBe(1);cache.set("c",3);
    expect(cache.get("b")).toBeUndefined();expect(cache.get("c")).toBe(3);
  });
  it("bounds memory, handles replacement, and refuses oversized values",()=>{
    const cache=new StrategyCache<string>(8,30);
    cache.set("a","12345");cache.set("b","12345");expect(cache.get("a")).toBeUndefined();
    cache.set("b","x");cache.set("c","x");expect(cache.get("b")).toBe("x");
    cache.set("large","x".repeat(100));expect(cache.get("large")).toBeUndefined();
  });
});
