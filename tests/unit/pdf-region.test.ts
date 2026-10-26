import { describe, expect, it } from "vitest";
import { boundedPdfRegionGeometry, pdfRegion, requireImageGeometry } from "../../lib/extraction/image";
import type { PreparedPageImage } from "../../lib/extraction/image";
describe("PDF 영역 판독의 원본 좌표와 제한",()=>{
  for(const rotation of [0,90,180,270] as const) it(`영역 모서리가 회전 ${rotation}에서도 일치한다`,()=>{
    const region={x:0.14,y:0.08,width:0.48,height:0.47}; const geometry=boundedPdfRegionGeometry(595,841,region,rotation);
    const image:PreparedPageImage={...geometry,sourceToImage:[...geometry.sourceToImage],region,sourceWidth:595,sourceHeight:841,rotation,coordinateSpace:"pdf-region",dataUrl:"data:image/png;base64,AQ==",mime:"image/png",bytes:1,sha256:"a".repeat(64)};
    expect(()=>requireImageGeometry(image)).not.toThrow();expect(geometry.width*geometry.height).toBeLessThanOrEqual(2560000);
    const [a,b,c,d,e,f]=geometry.sourceToImage;
    for(const x of [595*region.x,595*(region.x+region.width)]) for(const y of [841*region.y,841*(region.y+region.height)]) {
      expect(a*x+c*y+e).toBeGreaterThanOrEqual(-0.000001);expect(a*x+c*y+e).toBeLessThanOrEqual(geometry.width+0.000001);
      expect(b*x+d*y+f).toBeGreaterThanOrEqual(-0.000001);expect(b*x+d*y+f).toBeLessThanOrEqual(geometry.height+0.000001);
    }
    expect(()=>requireImageGeometry({...image,sourceToImage:[a,b,c,d,e+1,f]})).toThrow();
    expect(()=>requireImageGeometry({...image,region:undefined})).toThrow();
    expect(()=>requireImageGeometry({...image,coordinateSpace:"pdf-raster"})).toThrow();
  });
  it("영역 밖·빈 영역·비정상 크기를 거부한다",()=>{
    for(const region of [{x:0.9,y:0,width:0.2,height:1},{x:0,y:0,width:0,height:1},{x:-0.1,y:0,width:1,height:1}]) expect(pdfRegion.safeParse(region).success).toBe(false);
    expect(()=>boundedPdfRegionGeometry(NaN,841,{x:0,y:0,width:1,height:1},0)).toThrow();
  });
});
