// Candidate screening only: this never assigns stars, invents a duration or
// authorizes publication. Require a concrete financing-pressure mechanism in
// the same bounded passage as the AI/infrastructure subject.
const subject=/\b(?:AI|artificial intelligence|semiconductor|chip(?:s|makers?)?|neocloud|data cent(?:er|re)s?|CoreWeave|Nebius)\b|半導体|データセンター|人工知能|AI企業/i;
const mechanism=/\b(?:higher|rising|mounting|elevated) (?:interest rates|borrowing costs|financing costs)\b[^.!?\n]{0,160}\b(?:curb|choke|limit|delay|threaten|weigh on|pressure)\w*\b|\b(?:debt|bonds?)\b[^.!?\n]{0,100}\b(?:distress|crisis of confidence|default|defaults|defaulted)\b|(?:借入|資金調達|調達)コスト(?:の)?(?:上昇|増加|高騰)[^。\n]{0,100}(?:圧迫|遅延|抑制|懸念)|債務[^。\n]{0,80}(?:不履行|信用不安)/i;
const denial=/\b(?:not|never|no longer|denied|denies|without)\b|懸念はない|影響はない|否定|解消/i;
const boilerplate=/forward[- ]looking statements?|risk factors|safe harbor|将来に関する記述|免責事項/i;
export function hasConcreteBodyDownside(body){
 if(typeof body!=='string')return false;
 const checked=body.slice(0,12000).split(boilerplate)[0];
 return checked.split(/\n+/).some(paragraph=>paragraph.length<=600&&subject.test(paragraph)&&mechanism.test(paragraph)&&!denial.test(paragraph));
}
