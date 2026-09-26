import { blankMember, defaultPhase, strategyRequestSchema } from "../shared/strategy";
import type { OrganizationSnapshot } from "../shared/types";

export function strategyFixture(teamCount = 3) {
  const root = {...blankMember("root",null,"demo","2026-07"),displayName:"本人",sponsorLicense:true};
  const members = [root, ...["sub1","sub2"].map(id=>({...blankMember(id,"root","demo","2026-07"),displayName:id,idKind:"sub" as const,masterMemberId:"root",sponsorLicense:true}))];
  const base:OrganizationSnapshot={workspaceId:"demo",period:"2026-07",members,purchases:members.map(m=>({id:`p-${m.id}`,workspaceId:"demo",memberId:m.id,period:"2026-07",productCode:null,quantity:1,kind:"repeat",status:"confirmed",price:9950,pv:5330}))};
  const phase=defaultPhase();
  for(const b of ["standard","conservative","challenge"] as const) phase.rates[b]={introductions:1,activity:0,perRecruiter:0,retention:1,exitRate:0,reactivation:0};
  const request=strategyRequestSchema.parse({rootId:"root",partnerId:null,targetId:"root",horizonMonths:12,placementMode:"manual",allowSubCreation:false,
    leaders:Array.from({length:teamCount},(_,i)=>({id:`team${i}`,name:`チーム${i}`,existingMemberId:null,introducerId:"root",placementId:"root",startMonth:1,initialTeam:0,licenseAfterMonths:null,phases:[structuredClone(phase)]})),
    ownedMonthlyCosts:{},courseMonthlyCosts:{A:9950,B:19900,F:13170,G:26340,I:0},taxes:{root:{invoiceRegistered:true,withholdingRate:0,transferFee:0,offsets:0,priorCarryover:0}}});
  return {base,request};
}
