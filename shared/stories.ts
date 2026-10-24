/**
 * Storylines for the narrator. One is picked per game. Lines rotate by round, and
 * `{name}` is replaced with the player's name.
 */
export interface Story {
  id: string;
  title: string;
  intro: string;
  night: string[];
  death: string[];
  /** Nobody died: the doctor saved them, or the mafia held back. */
  quiet: string[];
  voteOut: string[];
  noVote: string[];
  townWins: string;
  mafiaWins: string;
}

export const STORIES: Story[] = [
  {
    id: 'noir',
    title: 'Rain on Ashford Street',
    intro:
      'Ashford Street, nineteen forty-seven. The rain never stops, the jazz never ends… and somebody in this room has blood on their gloves.',
    night: [
      'The neon flickers out. The city exhales smoke… and secrets.',
      'Midnight. A saxophone moans somewhere below. Somebody is making a decision.',
      'The rain drums on the window like impatient fingers.',
    ],
    death: [
      'They found {name} in the alley behind the Blue Lantern. No witnesses. There never are.',
      '{name} took their last drink at the bar tonight. Someone made sure of it.',
      "{name}'s hat was floating in the harbour by dawn. The rest of them followed.",
    ],
    quiet: [
      'A shot rang out in the dark… and missed. Someone was watching over this town.',
      'Morning comes grey and quiet. Everyone is still breathing. For now.',
    ],
    voteOut: [
      'The town has spoken. {name} is marched out into the rain.',
      'Fingers point. Voices rise. {name} walks the long walk down Ashford Street.',
    ],
    noVote: [
      'Nobody blinks. The town lets its suspects keep their secrets another night.',
      'Whispers, glances, nothing more. The mob goes home empty-handed.',
    ],
    townWins: 'The last of the mob is behind bars. Ashford Street sleeps easy… for once.',
    mafiaWins: "The family owns Ashford Street now. Pour yourself a drink. You're working for them.",
  },
  {
    id: 'sicily',
    title: 'The Village of Corleto',
    intro:
      'Corleto, Sicily. A sun-baked village where the lemons grow sweet… and loyalties grow sour. The Family has come home.',
    night: [
      'The church bell tolls midnight. Shutters close. Hearts beat faster.',
      'The olive groves fall silent. Even the dogs have stopped barking.',
      "Moonlight on the piazza. Someone is walking where they shouldn't.",
    ],
    death: [
      '{name} was found at the well, a single white rose in their hand.',
      'The village wakes to bad news. {name} will not be at mass this morning.',
      '{name} went for an evening stroll… and never came home.',
    ],
    quiet: [
      'The Family moved in the night, but someone stood in their way. Everyone wakes up alive.',
      'A peaceful morning. Too peaceful.',
    ],
    voteOut: [
      'The piazza decides. {name} is put on the last bus out of Corleto.',
      'The elders nod. {name} is banished from the village.',
    ],
    noVote: [
      'The village argues until the espresso goes cold. Nobody is sent away.',
      'Doubt wins the day. Nobody leaves Corleto.',
    ],
    townWins: 'The Family is broken. Corleto dances in the piazza until dawn.',
    mafiaWins: 'The Family controls Corleto now. Kiss the ring.',
  },
  {
    id: 'train',
    title: 'The Midnight Express',
    intro:
      'The Midnight Express, Paris to Istanbul. Snow has stopped the train in the mountains. Nobody gets off… and not everyone will arrive.',
    night: [
      'The cabin lights dim. The train creaks in the snow.',
      'Footsteps in the corridor. A door clicks shut.',
      'The engine sighs. Somewhere, a compartment door slides open.',
    ],
    death: [
      'The conductor screams. {name} lies still in compartment seven.',
      "{name}'s tea went cold. So did {name}.",
      '{name} was found in the dining car, a silver fork still in hand.',
    ],
    quiet: [
      "Breakfast is served. Every seat is filled. Someone's plan failed.",
      'The snow falls. The passengers wake. All of them.',
    ],
    voteOut: [
      'The passengers vote. {name} is locked in the baggage car.',
      '{name} is escorted off the train… into the snow.',
    ],
    noVote: [
      "The passengers can't agree. The train sits silent in the snow.",
      'Accusations fly like snowflakes, but no one is locked away.',
    ],
    townWins: 'The killers are in chains. The Midnight Express rolls on toward Istanbul.',
    mafiaWins: 'The killers have the train. The next stop is wherever they say.',
  },
  {
    id: 'western',
    title: 'Dry Gulch',
    intro:
      "Dry Gulch, Arizona. One saloon, one sheriff's star… and a gang of outlaws hiding behind friendly faces.",
    night: [
      'The saloon piano stops. Tumbleweeds roll down the empty street.',
      'Coyotes howl. A lantern goes out on Main Street.',
      'The moon hangs over the mesa like a wanted poster.',
    ],
    death: [
      'At sunrise, {name} was found face down by the water trough.',
      "{name}'s horse came back to town alone.",
      "Six shots in the night. {name} won't be riding out again.",
    ],
    quiet: [
      'Gunfire in the night, but the doc got there first. Everyone wakes up breathing.',
      "The rooster crows. Everyone's still here. Strange.",
    ],
    voteOut: [
      'The town gathers at the hanging tree. {name} is run out of Dry Gulch.',
      'Dry Gulch has decided. {name} rides out at noon, never to return.',
    ],
    noVote: [
      'Hands hover over holsters… but nobody draws.',
      "The town can't agree. The outlaws grin beneath their hats.",
    ],
    townWins: 'The outlaws are run out of town. Dry Gulch raises a glass of whiskey.',
    mafiaWins: "The outlaws own Dry Gulch now. The sheriff's star lies in the dust.",
  },
  {
    id: 'space',
    title: 'Station Erebus',
    intro:
      'Station Erebus, orbiting a dying star. Two hundred days from home… and something on board is not what it seems.',
    night: [
      'Night cycle engaged. The corridors glow red.',
      'The reactor hums. An airlock cycles where no one should be.',
      'Life support whispers. The cameras glitch for exactly ninety seconds.',
    ],
    death: [
      "The airlock log shows one exit. {name}'s.",
      "{name}'s life signs flatlined at oh-three-hundred hours.",
      'Medical bay. {name}. Too late.',
    ],
    quiet: [
      'Morning cycle. All crew vitals green. Someone failed tonight.',
      'The station wakes. Every heartbeat accounted for.',
    ],
    voteOut: [
      'Crew vote recorded. {name} is sealed in an escape pod and launched.',
      '{name} is confined to cryo-sleep. Indefinitely.',
    ],
    noVote: [
      'No consensus. The command log stays empty.',
      'The crew argues until the oxygen alarm sounds. Nobody is confined.',
    ],
    townWins: 'The infiltrators are spaced. Erebus sets a course for home.',
    mafiaWins: 'The infiltrators control the station. Earth will never hear from Erebus again.',
  },
  {
    id: 'london',
    title: 'Fog over Whitechapel',
    intro:
      'London, eighteen eighty-eight. The fog rolls in thick off the Thames… and in Whitechapel, a society of killers takes tea with its victims.',
    night: [
      'The gas lamps hiss. Fog swallows the cobblestones.',
      'Big Ben strikes midnight. A carriage rattles off into the dark.',
      'The fog is thicker tonight. It hides everything.',
    ],
    death: [
      "The constable's whistle shrieks. {name} lies on the cobblestones.",
      '{name} went out for laudanum and never returned.',
      'A calling card on the doorstep. {name} has been… collected.',
    ],
    quiet: [
      'The fog lifts and everyone is accounted for. Someone was saved.',
      'The milk cart rattles past. No screams this morning.',
    ],
    voteOut: [
      'The inquest has ruled. {name} is taken to Newgate.',
      '{name} is dragged before the magistrate and sent to the gallows.',
    ],
    noVote: [
      'The inquest is adjourned. Not enough evidence.',
      'Tea is poured. Accusations are swallowed. No one is arrested.',
    ],
    townWins: 'Scotland Yard has its killers. The fog lifts over Whitechapel.',
    mafiaWins: 'The Society rules the fog now. London will never sleep soundly again.',
  },
  {
    id: 'pirate',
    title: 'The Crimson Tide',
    intro:
      'The Crimson Tide, three weeks from port with a hold full of gold. The crew smiles at you. Some of them are mutineers.',
    night: [
      'Lanterns out. The ship rolls in the black swell.',
      "The bosun's whistle falls silent. Only the waves speak now.",
      'A cutlass glints in the moonlight below deck.',
    ],
    death: [
      'At dawn the crew counts heads. {name} is missing. A splash was heard.',
      '{name} was found tangled in the rigging, cold as the sea.',
      '{name} went to check on the gold… and never came back up.',
    ],
    quiet: [
      'A struggle in the dark, but every sailor answers the morning roll call.',
      'Calm seas. Full crew. Suspicious.',
    ],
    voteOut: [
      'The crew has voted. {name} walks the plank.',
      '{name} is marooned on a rock with one bottle of rum.',
    ],
    noVote: [
      'The crew grumbles, but no one walks the plank today.',
      'Too much rum, not enough proof. Everyone stays aboard.',
    ],
    townWins: 'The mutineers are fed to the sharks. The Crimson Tide sails home rich.',
    mafiaWins: 'Mutiny! The Crimson Tide flies a new flag tonight.',
  },
  {
    id: 'venice',
    title: 'Masquerade in Venice',
    intro:
      'Venice, Carnival night. Silk, candlelight and masks. Behind some of those masks… are smiles that kill.',
    night: [
      'The orchestra pauses. The candles gutter. Masks turn toward one another.',
      'A gondola slides past without a sound.',
      'Champagne glasses clink in the dark. A dance becomes a hunt.',
    ],
    death: [
      'A scream from the balcony. {name} lies beneath their mask, perfectly still.',
      "{name}'s mask floats in the canal. Its owner does not.",
      '{name} danced their last waltz tonight.',
    ],
    quiet: [
      'Morning light on the canals. Every mask still has a face beneath it.',
      'A blade was drawn in the dark… and turned away. Everyone survives.',
    ],
    voteOut: [
      'The guests demand a face. {name} is unmasked and thrown out of the palazzo.',
      '{name} is escorted to the water gate. The party continues without them.',
    ],
    noVote: [
      'The guests whisper behind their fans, but nobody is unmasked.',
      'Too many secrets, not enough proof. The masks stay on.',
    ],
    townWins: 'The assassins are unmasked. Venice dances until sunrise.',
    mafiaWins: 'The assassins remove their masks. The palazzo is theirs now.',
  },
  {
    id: 'chalet',
    title: 'Snowbound',
    intro:
      'A ski chalet high in the Alps. An avalanche closed the road. The phones are dead. The fire is warm… and so are the killers.',
    night: [
      'The fire burns low. The wind howls against the shutters.',
      'Snow buries the windows. Somebody tiptoes past the bedrooms.',
      "The hot tub bubbles in the dark. Nobody's in it. Yet.",
    ],
    death: [
      'They found {name} in the sauna. It was very, very hot.',
      "{name}'s skis are by the door. {name} is not.",
      '{name} went out for firewood. The snow kept them.',
    ],
    quiet: [
      'Fresh snow, fresh coffee, everyone alive. Lucky.',
      'The fire is relit. Every guest comes down for breakfast.',
    ],
    voteOut: [
      'The guests vote. {name} is locked in the wine cellar.',
      '{name} is sent out into the storm to find help. Good luck.',
    ],
    noVote: [
      'Too cold to decide. Everyone stays by the fire.',
      'The vote ends in a stalemate… and another bottle of wine.',
    ],
    townWins: 'The killers are tied up in the ski room. Spring will come.',
    mafiaWins: 'The road reopens. Only the killers ski down the mountain.',
  },
  {
    id: 'vegas',
    title: 'Last Call at the Starlight',
    intro:
      'Las Vegas, nineteen sixty-two. The Starlight Casino. The dice are hot, the drinks are cold… and the house has hired some friends.',
    night: [
      'The slot machines go dark. The roulette wheel stops spinning.',
      'Somewhere in the penthouse, a deal is being made.',
      'The neon sign buzzes. Last call.',
    ],
    death: [
      '{name} hit the jackpot tonight. Then the jackpot hit back.',
      '{name} was found in the desert, holding a pair of aces.',
      '{name} checked out of the Starlight. Permanently.',
    ],
    quiet: [
      'The sun rises over the strip. Everyone is still at the table.',
      'Luck was a lady tonight. Nobody died.',
    ],
    voteOut: [
      'The house has decided. {name} is shown the door… and the desert.',
      '{name} is cashed out and put in a taxi to nowhere.',
    ],
    noVote: [
      'Nobody bets. The cards stay face down.',
      "The table can't agree. The house always wins in the end.",
    ],
    townWins: 'The mob is busted. The Starlight shines clean tonight.',
    mafiaWins: 'The house always wins. And the house is theirs.',
  },
];

export function getStory(id: string | null | undefined): Story {
  return STORIES.find((s) => s.id === id) ?? STORIES[0];
}

/** Picks the line for this round, so each night and day sounds different. */
export function storyLine(lines: string[], round: number, name = ''): string {
  return lines[(Math.max(1, round) - 1) % lines.length].split('{name}').join(name);
}
