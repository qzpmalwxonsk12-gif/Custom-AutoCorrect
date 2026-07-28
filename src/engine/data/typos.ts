/**
 * High-precision typo table retained from the original engine. The correction
 * engine cross-checks each left-hand side against the bundled ESDB dictionary
 * before applying it, because a few strings (such as "abut" and "wont") also
 * have legitimate real-word uses.
 *
 * Two-letter entries such as `im:i'm` live here because the candidate
 * generator has a three-character floor; the capitalisation rule then lifts
 * the result to "I'm".
 *
 * Format: `typo:correction` pairs separated by whitespace. Corrections that
 * contain whitespace are double-quoted. Stored as one string so the parsed Map
 * is built once, lazily, with no per-entry object cost.
 */
import { normaliseRuleText } from '../../shared/util.js';

const RAW = `
waht:what teh:the becuase:because oir:or recieve:receive recieved:received
adn:and taht:that thier:their thsi:this hte:the tehn:then whic:which whcih:which
thnks:thanks thx:thanks im:i'm
wiht:with witht:with woh:who yuo:you yoru:your youre:you're ythe:the tje:the
abou:about abut:about accomodate:accommodate accomodation:accommodation
acheive:achieve acheived:achieved acheivement:achievement acknowlege:acknowledge
acquaintence:acquaintance acquiantance:acquaintance adress:address adressed:addressed
agian:again agin:again allready:already alot:"a lot" alwasy:always alway:always
amoung:among anaylsis:analysis annoucement:announcement apparant:apparent
appearence:appearance approrpiate:appropriate aquire:acquire arguement:argument
artical:article assistent:assistant athiest:atheist attendence:attendance
autoamtic:automatic avaliable:available availalbe:available aviable:available
awya:away basicly:basically bcak:back becuse:because befoer:before begining:beginning
beleive:believe beleived:believed belive:believe beteen:between betwen:between
beutiful:beautiful bizzare:bizarre boyfreind:boyfriend brodcast:broadcast
buisness:business bussiness:business calender:calendar cancelation:cancellation
carrer:career catagory:category cemetary:cemetery changable:changeable
cheif:chief childrens:children's cieling:ceiling collegue:colleague
comming:coming commitee:committee committe:committee comparsion:comparison
completly:completely concious:conscious congradulations:congratulations
consciencious:conscientious consistant:consistent contsruction:construction
controll:control conveniant:convenient copmany:company corect:correct
correcly:correctly coudl:could couldnt:couldn't cpoy:copy dailly:daily
decison:decision defenitely:definitely definately:definitely definatly:definitely
desicion:decision desireable:desirable develope:develop
developement:development diffrence:difference diferent:different differnt:different
dilemna:dilemma disapear:disappear disapoint:disappoint disatisfied:dissatisfied
discribe:describe dissapear:disappear dissapointed:disappointed doese:does
doign:doing donig:doing dont:don't dosnt:doesn't ect:etc efficency:efficiency
embarass:embarrass embarrasing:embarrassing enviroment:environment
equiptment:equipment esle:else especialy:especially espesially:especially
excelent:excellent excercise:exercise exerience:experience existance:existence
experiance:experience explaination:explanation extremly:extremely familar:familiar
fasion:fashion febuary:february fianlly:finally finaly:finally flourescent:fluorescent
foriegn:foreign forsee:foresee fourty:forty freind:friend freinds:friends
fromt:front fucntion:function fufill:fulfil garantee:guarantee
gaurd:guard geting:getting goign:going gonig:going govenment:government
goverment:government gramar:grammar greatful:grateful guage:gauge
happend:happened harrass:harass hasnt:hasn't havent:haven't heigth:height
helpfull:helpful herat:heart hierachy:hierarchy hospitol:hospital hten:then
htere:there htis:this humerous:humorous idae:idea ihs:his imediately:immediately
immediatly:immediately importent:important independant:independent indispensible:indispensable
inteligent:intelligent interupt:interrupt irrelevent:irrelevant isnt:isn't
jsut:just knowlege:knowledge labratory:laboratory
lenght:length liason:liaison libary:library lieing:lying liek:like
likly:likely maintainance:maintenance maintenence:maintenance
managment:management manuever:manoeuvre marrage:marriage mesage:message
millenium:millennium miniscule:minuscule mispell:misspell mispelled:misspelled
morgage:mortgage mroe:more mysef:myself neccessary:necessary necesary:necessary
neice:niece nieghbour:neighbour noone:"no one" noticable:noticeable
nowdays:nowadays nto:not occassion:occasion occured:occurred occuring:occurring
ocur:occur ofcourse:"of course" ofr:for ohter:other omre:more
onyl:only opinon:opinion oppurtunity:opportunity orginal:original
otehr:other outof:"out of" paide:paid parliment:parliament particulary:particularly
pased:passed passtime:pastime peice:piece peices:pieces peopel:people
perhasp:perhaps perminant:permanent perserverance:perseverance personel:personnel
persue:pursue peverse:perverse phyical:physical playwrite:playwright
poeple:people posession:possession possable:possible potatoe:potato
practicaly:practically preformance:performance prefered:preferred
prehaps:perhaps prepair:prepare presance:presence privelege:privilege
privilage:privilege probaly:probably probelm:problem proffesional:professional
programing:programming promiss:promise pronounciation:pronunciation
prosess:process publically:publicly quater:quarter questoin:question
quik:quick realiy:really realy:really recieving:receiving recomend:recommend
recomendation:recommendation refered:referred referal:referral reguard:regard
relevent:relevant religous:religious remeber:remember rember:remember
repetion:repetition responsability:responsibility restarant:restaurant
resturant:restaurant rhythem:rhythm ridiculus:ridiculous rythm:rhythm
saidn:said sceduled:scheduled seach:search secratary:secretary
seperate:separate seperated:separated seperately:separately sepearte:separate
sergent:sergeant sevral:several shcool:school shoudl:should shouldnt:shouldn't
similiar:similar sincerly:sincerely sitll:still smae:same soem:some
sohw:show somthing:something soemthing:something sould:should speach:speech
statment:statement stnad:stand strenght:strength strentgh:strength
succesful:successful successfull:successful sucess:success sucessful:successful
supercede:supersede supress:suppress suprise:surprise surpirse:surprise
sytem:system tahn:than tath:that tehy:they temperture:temperature
tempoary:temporary tendancy:tendency tewnty:twenty
theres:there's threshhold:threshold tihs:this tommorow:tomorrow tommorrow:tomorrow
tomorow:tomorrow tounge:tongue transfered:transferred truely:truly
tyhe:the tyme:time unfortunatly:unfortunately untill:until usualy:usually
vacum:vacuum vegatable:vegetable vehical:vehicle visable:visible
volunteeer:volunteer wachting:watching waitng:waiting wasnt:wasn't
watn:want wehn:when werent:weren't wether:whether whant:want whats:what's
whe:the whern:when wierd:weird wille:will wnat:want wont:won't
worls:world woudl:would wouldnt:wouldn't writting:writing wrok:work
wtih:with yaer:year yeasr:years yera:year ytou:you
`;

let table: Map<string, string> | null = null;

/** Lazily parsed typo -> correction map (lower-case keys). */
export function typoTable(): Map<string, string> {
  if (table) return table;
  const m = new Map<string, string>();
  const pairPattern = /(?:^|\s)([^:\s]+):(?:"([^"]+)"|([^\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pairPattern.exec(RAW)) !== null) {
    const key = match[1]!;
    const value = match[2] ?? match[3] ?? '';
    if (key && value && key !== value) m.set(key, value);
  }
  table = m;
  return m;
}

export function lookupTypo(word: string): string | undefined {
  return typoTable().get(normaliseRuleText(word));
}
