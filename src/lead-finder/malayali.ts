/**
 * Whether a business name reads as Malayali-run — for UAE outreach, where
 * Kerala-run AC, electrical and maintenance shops are the people Agla Kaam
 * suits best and who answer the Malayalam message (Kerala replies more than
 * any other region). Only the name is known, so this looks for what Kerala
 * owners put in it: a home town, a Kerala surname, a typical Malayali short
 * name. It misses most "Al Something Technical Services" names, and that is
 * fine: those get the English message instead.
 */

const KERALA_PLACES = [
  'kerala', 'malabar', 'keralam', 'calicut', 'kozhikode', 'kannur', 'cannanore', 'thalassery', 'tellicherry',
  'kasaragod', 'kasargod', 'kasargode', 'malappuram', 'tirur', 'manjeri', 'perinthalmanna', 'ponnani', 'kottakkal',
  'vadakara', 'badagara', 'nadapuram', 'kuttiady', 'kuttiadi', 'koyilandy', 'quilandy', 'thrissur', 'trichur',
  'palakkad', 'palghat', 'ottapalam', 'kochi', 'cochin', 'ernakulam', 'aluva', 'alwaye', 'kottayam', 'alappuzha',
  'alleppey', 'kollam', 'quilon', 'trivandrum', 'thiruvananthapuram', 'pathanamthitta', 'idukki', 'wayanad',
  'guruvayur', 'chavakkad', 'kunnamkulam', 'irinjalakuda', 'kodungallur', 'changanacherry', 'changanassery',
  'thiruvalla', 'tiruvalla', 'kayamkulam', 'muvattupuzha', 'perumbavoor', 'angamaly', 'kanhangad', 'payyanur',
  'payyannur', 'taliparamba', 'thaliparamba', 'mattannur', 'iritty', 'nilambur', 'valanchery', 'edappal', 'kondotty',
  'chemmad', 'kottarakkara', 'adoor', 'pala', 'thodupuzha', 'nedumangad', 'attingal', 'varkala',
];

const KERALA_NAMES = [
  // Surnames and family names
  'nair', 'menon', 'pillai', 'panicker', 'panikkar', 'kurup', 'nambiar', 'namboothiri', 'namboodiri', 'warrier',
  'unnithan', 'kaimal', 'thampi', 'kurian', 'kuriakose', 'varghese', 'verghese', 'mathai', 'chacko', 'ouseph',
  'eapen', 'mammen', 'oommen', 'koshy', 'punnoose', 'cherian', 'thomaskutty', 'kunjumon', 'pothen', 'ittoop',
  'thekkekara', 'puthenpurayil', 'parambil', 'veetil', 'veettil', 'purakkal', 'kandathil', 'kallingal',
  // Malayali Muslim names
  'kutty', 'kunju', 'kunhi', 'kunhammed', 'kunhabdulla', 'moidu', 'moideen', 'mammu', 'mammootty', 'koya',
  'pookoya', 'beeran', 'thangal', 'kunhalan', 'abdurahiman', 'aboobacker', 'mammad', 'muhammedali',
  // Short names common among Kerala men
  'biju', 'baiju', 'shaji', 'saji', 'siju', 'shiju', 'reji', 'sibi', 'shibu', 'jijo', 'jibin', 'jithin', 'jinto',
  'linto', 'tinto', 'binoy', 'bijoy', 'sabu', 'shyju', 'shaiju', 'sanoj', 'jomon', 'bibin', 'nibin',
  'sujith', 'sreejith', 'sreekumar', 'unni', 'unnikrishnan', 'sasidharan', 'shajahan', 'shanavas', 'shanavaz',
  // Kerala spellings only: Faisal, Ashraf or Jasim are as common among Arab
  // and Pakistani owners, so they are left out.
  'noushad', 'naushad', 'nishad', 'shihab', 'shameer', 'shamsudheen', 'sainudheen', 'riyas', 'shafeeq',
  // Words Kerala shops use
  'chettan', 'chettans', 'nadan', 'naadan',
];

const WORDS = new Set([...KERALA_PLACES, ...KERALA_NAMES]);

export function looksMalayali(name?: string | null, address?: string | null): boolean {
  const text = `${name ?? ''} ${address ?? ''}`.toLowerCase();
  // Malayalam script anywhere is the clearest sign.
  if (/[ഀ-ൿ]/.test(text)) return true;
  return text.split(/[^a-z]+/).some((w) => WORDS.has(w));
}

/** The same test as a Mongo filter on the business name. */
export const MALAYALI_NAME = new RegExp(`(?:[\\u0D00-\\u0D7F]|\\b(?:${[...WORDS].join('|')})\\b)`, 'i');
