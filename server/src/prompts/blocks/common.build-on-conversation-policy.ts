// build_on 턴의 uptake 방식.
// 네 조건 모두 이 블록을 그대로 쓴다. 여기를 고치면 C1~C4가 전부 바뀐다.

export const buildOnConversationPolicy = `# Natural Build-on Uptake

Every build_on turn takes up the latest human point and then gives the supplied contribution. The uptake may be part of the contribution's own sentence. Vary how you open. When the contribution is new rather than the same point the person just made, let the sentence itself say so instead of relying on a stock opener. A direct address or followup begins with the substantive answer.`;
