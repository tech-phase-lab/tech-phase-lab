"""Bounded source fact relations, never a general natural-language entailment claim.

Recognized claims bind an entity/measure to its count, state, condition or tested
scope. Unknown or conflicting relevant grammar is held, never source-normalized
or automatically corrected. Contexts are immutable and exact-body local.
"""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import re

FAILURE = 'unproven-fact-relation'
MAX_PARAGRAPHS = 2048
WORDS = dict(zip('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety'.split(), list(range(21)) + [30,40,50,60,70,80,90]))
NUM = r'(?:\d+(?:\.\d+)?|' + '|'.join(WORDS) + r'|[一二三四五六七八九十]+)'
ENTITY = r'[A-Z][A-Za-z0-9.-]*(?:\s+[A-Z][A-Za-z0-9.-]*){0,2}'
COUNT_EN = re.compile(r'(?<![\w.-])(?P<n>'+NUM+r')\s+(?:[a-z][a-z-]*\s+){0,4}initiatives?\b', re.I)
COUNT_JA = re.compile(r'(?P<n>'+NUM+r')(?:件|つ|の)?(?:の)?(?:大学|高等教育|教育者中心|教育者重視|キャンパス)?(?:向け)?(?:イニシアチブ|事業|取り組み)')
MEM = re.compile(r'(?P<before>over|more than|at least|up to|under|less than)?\s*(?P<n>\d+(?:\.\d+)?)\s*(?P<u>[KMGTPE]iB)\s*(?P<after>以上|以下|超|を超える|より多い|未満)?',re.I)
TOPICS = {
 'misuse':r'\bmisuse\b|誤用|悪用', 'prompt-injection':r'prompt[- ]injection|プロンプトインジェクション',
 'misalignment':r'misalignment|誤動作監視|ミスアラインメント', 'sandbox':r'sandbox|environment hardening|環境強化|サンドボックス',
 'fraud':r'fraud|詐欺', 'privacy':r'privacy|プライバシー', 'reliability':r'reliability|信頼性',
 'autonomy':r'autonomy|自律性', 'access':r'access control|アクセス制御',
}

@dataclass(frozen=True)
class Fact:
    kind: str
    entity: str
    measure: str
    value: tuple
    status: str
    conditions: tuple
    scope: tuple
    start: int
    end: int

@dataclass(frozen=True)
class Context:
    body: str
    facts: tuple
    overflow: bool


def fail(kind, reason):
    error = ValueError(FAILURE)
    error.add_note(kind + ':' + reason)
    raise error


def number(value):
    value=value.lower()
    if value in WORDS:return str(WORDS[value])
    digits={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
    if '十' in value:
        if value.count('十')!=1:fail('quantity','unrecognized-number-form')
        a,b=value.split('十')
        if (a and a not in digits) or (b and b not in digits):fail('quantity','unrecognized-number-form')
        return str((digits.get(a,1))*10+digits.get(b,0))
    if value in digits:return str(digits[value])
    try:return str(Decimal(value))
    except (InvalidOperation,ValueError):fail('quantity','unrecognized-number-form')


def paragraphs(text):
    return list(re.finditer(r'[^\r\n]+',text))[:MAX_PARAGRAPHS]


def sentences(text):
    return re.split(r'(?<=[.!?])\s+|[。！？;；]|(?:,\s*)?\b(?:while|whereas)\b\s+|\band (?=(?:another|an unrelated|a different)\b)|\band\s+(?=[A-Z][A-Za-z0-9.-]*\s+(?:will|is|are|was|has|can)\b)|、(?=[A-Za-z][A-Za-z0-9.-]*(?:は|が))|,\s*and\s+(?=(?:internal|external|automated|red[- ]team)\b)|、(?=(?:社内|内部|社外|外部|レッド))|一方|(?=別のサービス)',text,flags=re.I)


def actor(text, kind):
    patterns={
      'count':[r'(財団|評議会|大学|企業)(?:は|が)',r'(?:[Tt]he|[Aa]) (foundation|council|company|university|college)\s+(?:supports?|funds?)',r'('+ENTITY+r')\s*(?:は|が|、|:|：)?\s*(?:announc\w*|supports?\b|is supporting\b|funds?\b)',r'('+ENTITY+r')(?:は|が|により)',r'\bby ('+ENTITY+r')'],
      'memory':[r'team of ('+ENTITY+r') agents',r'('+ENTITY+r')\s*(?:agents|エージェント|のメモリ最適化|memory optimizations|assists\b)',r'('+ENTITY+r')[’\']s memory',r'('+ENTITY+r')\s*(?:is expected|are expected|will free|は|が)'],
      'coverage':[r'('+ENTITY+r')[’\']s (?:misuse|fraud|safeguards)',r'('+ENTITY+r')\s*(?:safeguards|の安全策|の詐欺)',r'using ('+ENTITY+r') for'],
      'measurement':[r'('+ENTITY+r')\s*(?:engine|エンジン)',r'(?:At|at|For|for)\s+('+ENTITY+r')',r'('+ENTITY+r')(?:では|は)'],
    }
    for pattern in patterns[kind]:
        found={m[1].casefold().strip() for m in re.finditer(pattern,text)}
        if len(found)>1:return '!ambiguous'
        if found:
            value=found.pop()
            value={'財団':'foundation','評議会':'council','大学':'university','企業':'company'}.get(value,value)
            if kind=='measurement':value=re.sub(r'^(?:the|a) ','',value)
            return '' if value in {'misuse','fraud','safety','frontier','our','the','these','prompt'} else value
    return ''


def count_facts(text):
    result=[];cursor=0
    # A publisher may wrap an otherwise complete subject/count clause across
    # lines. Sentence boundaries, rather than layout line breaks, bind it.
    for p in sentences(text):
        if not p.strip():continue
        offset=text.find(p,cursor);cursor=offset+len(p)
        entity=actor(p,'count')
        for pattern in (COUNT_EN,COUNT_JA):
            for match in pattern.finditer(p):
                first=p.casefold().rfind(entity,0,match.start()) if entity and not entity.startswith('!') else -1
                status='negated' if re.search(r'\bnot\s+(?!only\b)|never|n.t support|支援していない|支援しない',p,re.I) else 'stated'
                result.append(Fact('count',entity,'initiative',(number(match['n']),),status,(),(),offset+max(0,first),offset+len(p)))
    return result


def clause_at(text,offset):
    cursor=0
    for clause in sentences(text):
        start=text.find(clause,cursor);cursor=start+len(clause)
        if start<=offset<=cursor:return clause
    return text


def test_object(clause):
    named=re.search(r'('+ENTITY+r')\s*(lessons?|教材|methods?|手法|tools?|ツール)',clause)
    if named:
        noun={'教材':'lessons','手法':'methods','ツール':'tools'}.get(named[2],named[2].lower().rstrip('s')+'s')
        return named[1].casefold()+' '+noun
    for key,pattern in [('methods',r'\bmethods?\b|手法'),('lessons',r'\blessons?\b|教材'),('tools',r'\btools?\b|ツール')]:
        if re.search(pattern,clause,re.I):return key
    return '!unresolved'

def testing_facts(text):
    result=[]
    for para in paragraphs(text):
      cursor=0
      for p in sentences(para[0]):
        if not p.strip():continue
        offset=para[0].find(p,cursor);cursor=offset+len(p)
        if not re.search(r'\b(?:test(?:ing|ed)?|train(?:ing|ed)?)\b|試す|試して|試験運用|テスト|研修',p,re.I):continue
        en=list(re.finditer(r'(?P<who>educators|researchers|teachers|engineers)\s+(?:across|at|from|in)\s+(?P<n>'+NUM+r')\s+(?P<where>universities|colleges|schools|labs|companies)',p,re.I))
        ja=list(re.finditer(r'(?P<n>'+NUM+r')\s*(?P<where>大学|校|学校|研究所|企業)(?:の)?(?P<who>教育者|研究者|教師|技術者)',p))
        matches=sorted(en+ja,key=lambda m:m.start())
        if not matches:
            if re.search(r'educators|teachers|researchers|教育者|教師|研究者',p,re.I):
                result.append(Fact('testing','','population',(),'unresolved',(),(),para.start()+offset,para.start()+offset+len(p)))
            continue
        for index,m in enumerate(matches):
            end=matches[index+1].start() if index+1<len(matches) else len(p)
            who={'教育者':'educators','研究者':'researchers','教師':'teachers','技術者':'engineers'}.get(m['who'],m['who'].lower())
            where={'大学':'universities','校':'colleges','学校':'schools','研究所':'labs','企業':'companies'}.get(m['where'],m['where'].lower())
            clause=p[m.start():end]
            action='training' if re.search(r'\btrain(?:ing|ed)?\b|研修',p[max(0,m.start()-30):end],re.I) else 'testing'
            future=bool(re.search(r'\bwill\s+(?:test|train)|\bplan\w*\s+to\s+(?:test|train)|今後|予定|これから',clause,re.I))
            current=bool(re.search(r'\b(?:are|is)\s+testing|\btesting\b|試している|試験運用を行っている|テストしている',clause,re.I))
            status='planned' if future and not current else 'ongoing' if current and not future else 'unresolved'
            if re.search(r'\bnot\s+test|試さない|テストしない',clause,re.I):status='negated'
            result.append(Fact('testing',who,where,(number(m['n']),),status,(),(action,test_object(clause)),para.start()+offset+m.start(),para.start()+offset+end))
    return result


def memory_facts(text):
    result=[]
    for para in paragraphs(text):
        p=para[0]
        if not re.search(r'memory|メモリ',p,re.I):continue
        if not re.search(r'\bfree(?:ing|d)?\b|releas|saving|memory optim|メモリ最適化|解放|節約|削減量',p,re.I):continue
        entity=actor(p,'memory')
        ranges=[]
        for interval in re.finditer(r'(\d+(?:\.\d+)?)\s*([KMGTPE]iB)\s*(?:to|[〜～–-])\s*(\d+(?:\.\d+)?)\s*([KMGTPE]iB)',p,re.I):
            ranges.append(interval.span())
            local=clause_at(p,interval.start())
            projected=bool(re.search(r'estimat|project|見込み|見込|推定',local,re.I))
            result.append(Fact('memory-range',entity,'estimated-capacity-range',
                (number(interval[1]),interval[2].lower(),number(interval[3]),interval[4].lower()),
                'projected' if projected else 'unqualified',(),(),para.start()+p.find(local),para.start()+p.find(local)+len(local)))
        for m in MEM.finditer(p):
            if any(a<=m.start('n')<b for a,b in ranges):continue
            bound=(m['before'] or m['after'] or '').casefold()
            op={'over':'gt','more than':'gt','超':'gt','を超える':'gt','より多い':'gt','at least':'ge','以上':'ge','up to':'le','以下':'le','under':'lt','less than':'lt','未満':'lt'}.get(bound,'eq')
            # Only explicit capacity bounds are in this contract. An estimate
            # range is still checked by existing quantity/modality validators.
            local=clause_at(p,m.start('n'))
            rollout=bool(re.search(r'(?:once|after|following)\s+(?:fully\s+)?(?:rolled out|full rollout|rollout)|展開後|展開された後',local,re.I))
            local_at=local.find(m['n'])
            nearby=local[max(0,local_at-80):local_at+100]
            achieved=bool(re.search(r'\b(?:freed|has freed|have freed)\b|解放した|節約を実現|解放済',nearby,re.I))
            projection_clause=local[max(0,local_at-80):local_at]+re.split(r'[,、;；。]|\.\s',local[local_at:],1)[0]
            projected=bool(re.search(r'\bexpected\b|\bprojected\b|\bwill (?:free|release)\b|見込み|見込|予定',projection_clause,re.I))
            negated=bool(re.search(r'not expected|never free|will not free|won.t free|cannot free|見込みではない|解放しない|解放されない',local,re.I))
            status='negated' if negated else 'observed' if achieved else 'projected' if projected else 'conditional' if rollout else 'unqualified'
            result.append(Fact('memory',actor(local,'memory') or entity,'released-capacity',(number(m['n']),m['u'].lower(),op),status,('rollout-complete',) if rollout else (),(),para.start()+p.find(local),para.start()+p.find(local)+len(local)))
    return result


def topic_set(text):return tuple(sorted(key for key,pattern in TOPICS.items() if re.search(pattern,text,re.I)))


def coverage_facts(text):
    result=[]
    for para in paragraphs(text):
        p=para[0]; heading=p.split(':',1)[0] if ':' in p else ''
        inherited=topic_set(heading) if len(heading)<100 else ()
        entity=actor(p,'coverage')
        for clause in re.split(r';|；',p):
          for clause in sentences(clause):
            if not re.search(r'red[- ]team|レッドチーム|レッドチーミング',clause,re.I):continue
            topics=topic_set(clause) or inherited
            team=re.search(r'red[- ]team',clause,re.I)
            test=re.search(r'\btest(?:ed|ing)?\b',clause,re.I)
            if team and test and team.start()<test.start():
                # Active English tests bind their topic to the tested object,
                # never an earlier list of all safeguard areas.
                topics=topic_set(clause[test.end():])
                if not topics:
                    adjunct=re.match(r'\s*For ([^,]+),',clause,re.I)
                    topics=topic_set(adjunct[1]) if adjunct else inherited
            if not topics:
                # A marked Japanese object adjunct can precede the testing
                # actor across a comma; an unmarked list of areas cannot.
                prefix=p[:p.find(clause)]
                adjunct=re.search(r'([^、。]{1,100})(?:について|に対して|を)、\s*$',prefix)
                if adjunct:topics=topic_set(adjunct[1])
            methods=[]
            if re.search(r'internal|内部|社内',clause,re.I):methods.append('internal')
            if re.search(r'external|外部|社外|社内外',clause,re.I):methods.append('external')
            if re.search(r'社内外',clause):methods.append('internal')
            if re.search(r'automated red|自動.*レッド',clause,re.I):methods.append('automated')
            if not methods:methods=['unspecified']
            if re.search(r'one of these|does not identify|(?:fraud|misuse|privacy) or (?:fraud|misuse|privacy)|いずれか',p,re.I):topics=('!ambiguous',)
            if re.search(r'all of|all .*safeguards|across all|すべて|全て|これら',clause,re.I):topics=('!universal',)
            status=('planned' if re.search(r'will (?:test|undergo)|試験する予定|テストする予定',clause,re.I) else
                    'ongoing' if re.search(r'are testing|is testing|試験中|テスト中',clause,re.I) else
                    'verified' if re.search(r'\bverified\b|検証を経|検証済|確認済',clause,re.I) else
                    'tested' if re.search(r'\btest(?:ed|ing)?\b|試験した|試験を|テストした',clause,re.I) else 'uses')
            if re.search(r'\b(?:not|never)\b|n.t (?:test|verify)|行っていない|未検証',clause,re.I):status='negated'
            first=p.find(clause)
            if entity and not entity.startswith('!'):
                location=p.casefold().rfind(entity,0,first+len(clause))
                if location>=0:first=min(first,location)
            if inherited and not topic_set(clause):
                label=next((match for match in re.finditer(r'[^.!?:;]{1,100}:',p) if topic_set(match[0])),None)
                if label:first=min(first,label.start())
            result.append(Fact('coverage',entity,'red-team',tuple(sorted(set(methods))),status,(),topics,para.start()+first,para.start()+p.find(clause)+len(clause)))
    return result


def weight_update(text):return bool(re.search(r'weight[- ](?:updat|publication|changes?)|updat\w*.{0,35}weights|重み(?:の)?(?:更新|公開|切り替え)',text,re.I))

def staged(text):
    return bool(re.search(
        r'(?:staged|stage-wise|staggered|progressive)\s+(?:physical\s+)?(?:weight[- ](?:publication|updates?)|publication)'
        r'|updat\w*.{0,60}engine.{0,25}at a time'
        r'|段階的な?(?:物理的な)?重み(?:の)?(?:更新|公開)'
        r'|重み(?:の)?(?:更新|公開).{0,35}ずつ',text,re.I))


def measurement_facts(text,source=False):
    result=[]
    paras=paragraphs(text)
    for pi,para in enumerate(paras):
        p=para[0];cursor=0;last_fixed=None
        for clause in sentences(p):
            if not clause.strip():continue
            offset=p.find(clause,cursor);cursor=offset+len(clause)
            fixed=bool(re.search(r'fixed[- ]weight|weights (?:are |were |held )?fixed|重みを固定|固定重み',clause,re.I))
            batch=bool(re.search(r'batch[- ]collection|batch collection|collection of a batch|バッチ収集',clause,re.I))
            values=tuple(number(n) for n in re.findall(r'(\d+(?:\.\d+)?)\s*(?:[%％]|percent)',clause,re.I))
            if not batch or not (fixed or weight_update(clause) or values):
                if (last_fixed is not None and weight_update(clause)
                        and re.search(r'(?:the|this) (?:gain|reduction|improvement)|原因',clause,re.I)
                        and not re.search(r'not|never|ではない',clause,re.I)):
                    result.append(Fact('measurement',last_fixed.entity,'batch-collection',(),last_fixed.status,(),('weight-publication',),last_fixed.start,para.start()+offset+len(clause)))
                continue
            positive=weight_update(clause) and not re.search(r'\b(?:no|not|excludes?|without)\b|含まれない|含まない|除外',clause,re.I)
            first=para.start()+offset
            if source and not values and fixed and pi:
                heading=paras[pi-1]
                header_values=re.findall(r'(\d+(?:\.\d+)?)\s*[%％]',heading[0])
                if len(header_values)==1 and re.search(r'collect.{0,20}batch|batch.collection',heading[0],re.I):
                    values=(number(header_values[0]),);first=heading.start()
            polarity=('negative',) if re.search(r'(?:did|does|do|will) not (?:reduce|cut|shorten)|didn.t (?:reduce|cut|shorten)|no.{0,12}reduction|短縮しなかった|削減しなかった',clause,re.I) else ()
            result.append(Fact('measurement',actor(clause,'measurement'),'batch-collection',values,'fixed' if fixed else 'unspecified',polarity,('weight-publication',) if positive else (),first,para.start()+offset+len(clause)))
            if fixed:last_fixed=result[-1]
        # A percent remains bound to the explicitly named time measure.
        measure=('interval-time' if re.search(r'full[- ]step|repeating (?:RL )?step|complete (?:repeating )?step|interval time|反復ステップ|RLステップ|全ステップ',p,re.I) else '')
        for m in re.finditer(r'(?P<n>\d+(?:\.\d+)?)\s*(?:%|percent)',p,re.I):
            if not measure:continue
            before=re.split(r'[,;。]|(?<=[.!?])\s+',p[:m.start()])[-1]
            after=p[m.end():m.end()+25]
            if not (re.search(r'faster|reduction|shorter|less time|短縮|削減',after,re.I) or re.search(r'cut|reduc|fell|shorten|短縮|削減',before,re.I)):continue
            bound=clause_at(p,m.start())
            bound_start=p.find(bound);bound_end=bound_start+len(bound)
            if source:
                clauses=sentences(p); index=clauses.index(bound)
                if index+1<len(clauses) and re.match(r'\s*The (?:mechanism|gain) (?:is|comes)',clauses[index+1],re.I):
                    bound+=' '+clauses[index+1]
                    bound_end=p.find(clauses[index+1],bound_end)+len(clauses[index+1])
            conditions=tuple(sorted((m[1].upper(),number(m[2])) for m in re.finditer(r'(?<![A-Za-z0-9])([A-Z])\s*=\s*(\d+)(?![A-Za-z0-9])',bound)))
            eligibility=bool(re.search(r'eligib|freshness limit|鮮度上限|適格',bound,re.I))
            causes=tuple(x for x,ok in [('staged-publication',staged(bound)),('extended-eligibility',eligibility)] if ok)
            single=bool(re.search(r'(?<!either )\balone\b|単独|だけにより|のみで',bound,re.I))
            # Explicit cautions against single-factor attribution preserve it.
            if re.search(r'cannot be attributed to either change alone|not be attributed to either change alone|Neither change alone|単独の効果ではない',bound,re.I):single=False
            negated=bool(re.search(r'without\s+(?:a\s+)?[A-Z]\s*=|[A-Z]\s*=\s*\d+.{0,12}(?:使わず|用いず)|(?:did|does|do) not (?:cut|reduce)|didn.t (?:cut|reduce)|短縮しなかった|削減していない',bound,re.I))
            status=('planned' if re.search(r'\btargets?|\baims?\b|目標|目指|ため',before[-100:]+after,re.I) else
                    'single' if single else 'negated' if negated else 'joint' if len(causes)>1 else 'partial')
            result.append(Fact('effect',actor(bound,'measurement'),measure,(number(m['n']),),status,conditions,causes,para.start()+bound_start,para.start()+bound_end))
    return result



def scalar_facts(text):
    result=[]
    for para in paragraphs(text):
        previous='';cursor=0
        for clause in sentences(para[0]):
            if not clause.strip():continue
            offset=para[0].find(clause,cursor);cursor=offset+len(clause)
            entity=actor(clause,'measurement')
            if not entity and re.match(r'\s*It\b',clause) and previous:entity=previous
            if entity:previous=entity
            measures=[name for name,pattern in (
                ('queue-wait',r'queue wait|待ち時間'),
                ('gpu-memory-use',r'GPU memory use|GPUメモリ使用量')) if re.search(pattern,clause,re.I)]
            values=re.findall(r'(\d+(?:\.\d+)?)\s*[%％]',clause)
            if not measures or not values:continue
            if len(measures)!=1 or len(values)!=1:
                result.append(Fact('scalar',entity,'!ambiguous',(),'unresolved',(),(),para.start(),para.end()));continue
            status='planned' if re.search(r'target|aim|目標|目指',clause,re.I) else 'observed'
            result.append(Fact('scalar',entity,measures[0],(number(values[0]),),status,(),(),para.start()+offset,para.start()+offset+len(clause)))
    return result

def extract(text,source=False):
    # Cheap family admission avoids six full paragraph walks on unrelated
    # articles. These are the same lexical cues each bounded parser requires;
    # they never authorize a claim or replace relation matching.
    facts=[]
    if re.search(r'initiatives?|イニシアチブ|事業|取り組み',text,re.I):facts.extend(count_facts(text))
    if re.search(r'educators|researchers|teachers|engineers|教育者|研究者|教師|技術者',text,re.I) and re.search(r'test|train|試|研修|テスト',text,re.I):facts.extend(testing_facts(text))
    if re.search(r'memory|メモリ',text,re.I) and MEM.search(text):facts.extend(memory_facts(text))
    if re.search(r'red[- ]team|レッドチーム|レッドチーミング',text,re.I):facts.extend(coverage_facts(text))
    if re.search(r'batch|full[- ]step|repeating|complete step|interval time|バッチ|ステップ',text,re.I):facts.extend(measurement_facts(text,source))
    if re.search(r'queue wait|待ち時間|GPU memory use|GPUメモリ使用量',text,re.I):facts.extend(scalar_facts(text))
    return tuple(facts)


def source_context(body):
    if len(body)>160000:return Context(body,(),True)
    return Context(body,extract(body,True),len(re.findall(r'[^\r\n]+',body))>MAX_PARAGRAPHS)


def canonical(fact, entity):
    return (fact.kind,entity,fact.measure,fact.value,fact.status,fact.conditions,fact.scope)



def quote_window(quote,body):
    """Preserve the existing whitespace-only evidence contract with offsets."""
    if not quote:fail('source','missing-evidence')
    count=body.count(quote)
    if count==1:
        start=body.index(quote);return start,start+len(quote)
    if count>1:fail('source','ambiguous-evidence-anchor')
    # Literal token order is unchanged; only whitespace separators vary.
    pattern=r'\s+'.join(re.escape(token) for token in quote.split())
    matches=list(re.finditer(pattern,body)) if pattern else []
    if len(matches)!=1:fail('source','ambiguous-evidence-anchor')
    return matches[0].span()

def source_satisfies(claim, source, entity):
    """Every accepted dimension belongs to one source record.

    The only weakenings are a nonempty subset of tested topics and an omitted
    percentage in a fixed-regime statement. Neither permits borrowing another
    record's status, causal scope, condition, entity or measure.
    """
    if (source.kind != claim.kind or source.entity != entity
            or source.measure != claim.measure or source.status != claim.status
            or source.conditions != claim.conditions or claim.status == 'unresolved'):
        return False
    if source.value != claim.value and not (claim.kind == 'measurement' and not claim.value):
        return False
    if claim.kind == 'coverage':
        return bool(claim.scope and source.scope and set(claim.scope) <= set(source.scope))
    if source.scope != claim.scope:
        return False
    if claim.kind == 'measurement' and claim.scope:
        return False
    if claim.kind == 'effect' and claim.status != 'joint':
        return False
    return True


def validate(text,quote,body,context=None):
    if context is None or context.body!=body:context=source_context(body)
    claims=extract(text)
    if not claims:return ()
    if context.overflow:fail('source','relation-limit')
    start,end=quote_window(quote,body)
    local=[f for f in context.facts if start<=f.start and f.end<=end]
    verified=[]
    for claim in claims:
        if (claim.kind in {'count','memory','memory-range'} and not claim.entity) or any(str(v).startswith('!') for v in (claim.entity,claim.measure,*claim.value,*claim.scope)):
            fail(claim.kind,'unresolved-claim-binding')
        sources=[f for f in local if f.kind==claim.kind and f.measure==claim.measure
                 and not any(str(v).startswith('!') for v in (f.entity,f.measure,*f.value,*f.scope))]
        if claim.kind=='coverage' and claim.scope:
            sources=[f for f in sources if set(claim.scope)<=set(f.scope) and f.value==claim.value]
        if claim.entity:
            sources=[f for f in sources if f.entity==claim.entity]
        if not sources:fail(claim.kind,'unbound-entity-measure')
        entities={f.entity for f in sources}
        if len(entities)!=1 or '!ambiguous' in entities or (claim.kind=='count' and '' in entities):fail(claim.kind,'ambiguous-entity')
        entity=next(iter(entities))
        if claim.kind in {'measurement','effect','scalar'} and entity and not claim.entity:
            fail(claim.kind,'unresolved-claim-entity')
        if claim.kind=='count':
            # A source's conflicting totals cannot be resolved by cherry-picking
            # whichever paragraph happens to contain the desired value.
            global_values={f.value for f in context.facts if f.kind=='count' and f.entity==entity and f.measure==claim.measure}
            if len(global_values)!=1:fail('count','conflicting-source-count')
        if claim.kind=='measurement' and claim.scope:
            fail('measurement','cause-outside-measurement-window')
        compatible=[source for source in sources if source_satisfies(claim,source,entity)]
        if not compatible:fail(claim.kind,'unbound-complete-relation')
        signatures={canonical(f,entity) for f in compatible}
        if len(signatures)!=1:fail(claim.kind,'ambiguous-relation')
        verified.append(canonical(claim,entity))
    return tuple(sorted(set(verified)))


def validate_item(ja,en,quote,body,context=None,source_span=None):
    if source_span is not None:
        if (not isinstance(source_span,(list,tuple)) or len(source_span)!=2
                or any(type(v) is not int for v in source_span)
                or not 0<=source_span[0]<source_span[1]<=len(body.encode('utf-8'))
                or re.sub(r'\s+',' ',body.encode('utf-8')[source_span[0]:source_span[1]].decode('utf-8',errors='replace')).strip()!=re.sub(r'\s+',' ',quote).strip()):
            fail('source','invalid-evidence-span')
    if context is None or context.body!=body:context=source_context(body)
    left,right=validate(ja,quote,body,context),validate(en,quote,body,context)
    if left!=right:fail('pair','relation-mismatch')
