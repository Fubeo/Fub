// I dati delle emoji per `:nome` (H14), in un pezzo a parte che si carica alla
// prima richiesta. Una riga per emoji: il carattere, i nomi italiani, i nomi
// inglesi. Il primo nome di ciascuna lingua è quello che il menu mostra; gli
// altri si cercano soltanto. I nomi inglesi seguono gli shortcode di GitHub
// e Slack, così chi li conosce li ritrova.
const DATA = `
😀|sorriso faccia felice|grinning smile happy
😃|sorriso aperto gioia|smiley joy
😄|sorriso occhi ridenti|smile laugh
😁|sorriso denti|grin beaming
😆|risata forte|laughing satisfied
😅|sorriso sudore imbarazzo|sweat_smile relief
🤣|rotolo dalle risate|rofl rolling_on_the_floor_laughing
😂|lacrime di gioia ridere|joy tears_of_joy
🙂|sorrisetto lieve|slightly_smiling_face
🙃|capovolto ironia|upside_down_face
😉|occhiolino strizzare|wink
😊|arrossito contento timido|blush
😇|aureola angelo innocente|innocent halo angel
🥰|innamorato cuori|smiling_face_with_hearts in_love
😍|occhi a cuore amore|heart_eyes love
🤩|stelle colpito entusiasta|star_struck
😘|bacio mandare|kissing_heart kiss
😋|gustoso buono lingua|yum delicious
😛|lingua fuori|stuck_out_tongue
😜|lingua occhiolino scherzo|stuck_out_tongue_winking_eye
🤪|pazzo matto|zany_face crazy
🤑|soldi avido|money_mouth_face
🤗|abbraccio|hugs hugging
🤭|mano sulla bocca risatina|hand_over_mouth giggle
🤫|silenzio zitto|shushing_face quiet
🤔|pensare pensieroso dubbio|thinking hmm
🤐|bocca cucita segreto|zipper_mouth_face secret
🤨|sopracciglio scettico|raised_eyebrow skeptical
😐|neutro impassibile|neutral_face
😑|inespressivo|expressionless
😶|senza bocca muto|no_mouth
😏|ghigno furbo|smirk
😒|annoiato scontento|unamused
🙄|occhi al cielo|roll_eyes eye_roll
😬|smorfia disagio|grimacing awkward
😌|sollevato sereno|relieved calm
😔|pensieroso triste|pensive
😪|assonnato|sleepy
😴|dormire sonno|sleeping zzz
😷|mascherina malato|mask sick
🤒|febbre termometro|face_with_thermometer fever
🤕|ferito benda|face_with_head_bandage hurt
🤢|nausea|nauseated_face
🤮|vomito|vomiting_face
🥵|caldo afa|hot_face
🥶|freddo gelo|cold_face freezing
🥴|stordito brillo|woozy_face
😵|capogiro|dizzy_face
🤯|testa che esplode sbalordito|exploding_head mind_blown
🤠|cowboy cappello|cowboy_hat_face
🥳|festa compleanno|partying_face party
😎|occhiali da sole figo|sunglasses cool
🤓|secchione nerd|nerd_face
🧐|monocolo indagare|monocle_face
😕|confuso|confused
😟|preoccupato|worried
🙁|triste leggermente|slightly_frowning_face
😮|bocca aperta sorpreso|open_mouth surprised
😲|stupito sbalordito|astonished
😳|arrossito imbarazzato|flushed
🥺|supplica occhioni|pleading_face
😦|accigliato bocca aperta|frowning
😨|spaventato paura|fearful
😰|ansia sudore freddo|cold_sweat anxious
😥|deluso sollevato|disappointed_relieved
😢|pianto lacrima|cry
😭|piangere forte disperato|sob
😱|urlo terrore|scream
😖|confuso frustrato|confounded
😣|perseverante sforzo|persevere
😞|deluso|disappointed
😓|sudore freddo|sweat
😩|stanco esausto|weary
😫|sfinito|tired_face
🥱|sbadiglio noia|yawning_face yawn
😤|sbuffo trionfo|triumph huff
😡|furioso rabbia|rage pout angry
😠|arrabbiato|angry
🤬|parolacce imprecare|cursing_face
😈|diavoletto sorriso|smiling_imp devil
💀|teschio morto|skull dead
💩|cacca|poop hankey
🤡|pagliaccio|clown_face
👻|fantasma|ghost
👽|alieno|alien
🤖|robot|robot
😺|gatto sorriso|smiley_cat
❤️|cuore rosso amore|heart love red_heart
🧡|cuore arancione|orange_heart
💛|cuore giallo|yellow_heart
💚|cuore verde|green_heart
💙|cuore blu|blue_heart
💜|cuore viola|purple_heart
🖤|cuore nero|black_heart
🤍|cuore bianco|white_heart
💔|cuore spezzato|broken_heart
💕|due cuori|two_hearts
💯|cento perfetto|100 hundred
💢|rabbia simbolo|anger
💥|esplosione botto|boom collision
💫|stordito stelline|dizzy
💦|gocce sudore|sweat_drops
💬|fumetto parlare|speech_balloon
💭|fumetto pensiero|thought_balloon
👋|ciao saluto mano|wave hello hi
🤚|mano alzata dorso|raised_back_of_hand
✋|mano alzata stop|hand raised_hand
👌|ok perfetto|ok_hand
🤌|dita a borsa ma che vuoi|pinched_fingers italian
✌️|vittoria pace|v victory peace
🤞|dita incrociate fortuna|crossed_fingers luck
🤟|ti voglio bene mano|love_you_gesture
🤘|corna rock|metal rock
👈|indice sinistra|point_left
👉|indice destra|point_right
👆|indice su|point_up_2
👇|indice giù|point_down
☝️|indice alzato|point_up
👍|pollice su bene sì|+1 thumbsup like yes
👎|pollice giù male no|-1 thumbsdown dislike no
✊|pugno alzato|fist raised_fist
👊|pugno colpo|punch facepunch
👏|applauso battere le mani|clap applause
🙌|mani alzate evviva|raised_hands hooray
👐|mani aperte|open_hands
🤝|stretta di mano accordo|handshake deal
🙏|preghiera grazie per favore|pray thanks please
✍️|scrivere mano|writing_hand
💪|muscolo forza|muscle strong
🧠|cervello mente|brain
👀|occhi guardare|eyes look
👁️|occhio|eye
👶|neonato bambino|baby
🧒|bambino|child
👦|ragazzo|boy
👧|ragazza|girl
🧑|persona|adult person
👨|uomo|man
👩|donna|woman
🧓|anziano|older_adult
👮|poliziotto polizia|police_officer cop
👷|operaio cantiere|construction_worker
💂|guardia|guard
🕵️|investigatore detective|detective
🧑‍💻|programmatore informatico|technologist coder
🧑‍🎓|studente laureato|student
🧑‍🏫|insegnante professore|teacher
🧑‍⚕️|medico sanitario|health_worker doctor
🧑‍🍳|cuoco chef|cook chef
🙋|alzare la mano|raising_hand
🤷|scrollata di spalle boh|shrug
🤦|facepalm che vergogna|facepalm
🏃|correre corsa|runner running
🚶|camminare|walking
🐶|cane cucciolo|dog puppy
🐱|gatto|cat
🐭|topo|mouse
🐰|coniglio|rabbit bunny
🦊|volpe|fox
🐻|orso|bear
🐼|panda|panda
🐨|koala|koala
🐯|tigre|tiger
🦁|leone|lion
🐮|mucca|cow
🐷|maiale|pig
🐸|rana|frog
🐵|scimmia|monkey_face
🐔|gallina|chicken
🐧|pinguino|penguin
🐦|uccello|bird
🦆|anatra|duck
🦉|gufo civetta|owl
🐝|ape|bee honeybee
🐛|bruco|bug
🦋|farfalla|butterfly
🐌|lumaca|snail
🐢|tartaruga|turtle
🐍|serpente|snake
🐙|polpo|octopus
🐟|pesce|fish
🐬|delfino|dolphin
🐳|balena|whale
🌸|fiore di ciliegio|cherry_blossom
🌹|rosa|rose
🌻|girasole|sunflower
🌷|tulipano|tulip
🌱|germoglio piantina|seedling
🌲|abete albero|evergreen_tree
🌳|albero|deciduous_tree tree
🌴|palma|palm_tree
🌵|cactus|cactus
🍀|quadrifoglio fortuna|four_leaf_clover luck
🍁|foglia d'acero autunno|maple_leaf
🍂|foglie cadute|fallen_leaf
🍄|fungo|mushroom
🌍|terra mondo europa|earth_africa world globe
🌙|luna|crescent_moon moon
⭐|stella|star
🌟|stella brillante|star2 glowing_star
✨|scintille brillantini|sparkles
⚡|fulmine elettricità|zap lightning
🔥|fuoco fiamma|fire flame
🌈|arcobaleno|rainbow
☀️|sole|sunny sun
⛅|sole e nuvole|partly_sunny
☁️|nuvola|cloud
🌧️|pioggia|rain cloud_with_rain
⛈️|temporale|thunder_cloud_and_rain storm
❄️|neve fiocco|snowflake snow
☃️|pupazzo di neve|snowman
💧|goccia acqua|droplet water
🌊|onda mare|ocean wave
🍎|mela|apple
🍊|arancia|tangerine orange
🍋|limone|lemon
🍌|banana|banana
🍉|anguria cocomero|watermelon
🍇|uva|grapes
🍓|fragola|strawberry
🍒|ciliegie|cherries
🍑|pesca|peach
🍍|ananas|pineapple
🥝|kiwi|kiwi_fruit
🍅|pomodoro|tomato
🥑|avocado|avocado
🥕|carota|carrot
🌽|mais pannocchia|corn
🥔|patata|potato
🧄|aglio|garlic
🍞|pane|bread
🥐|cornetto croissant|croissant
🧀|formaggio|cheese
🥚|uovo|egg
🍳|padella uovo cucinare|fried_egg cooking
🥓|pancetta|bacon
🍕|pizza|pizza
🍝|pasta spaghetti|spaghetti pasta
🍔|hamburger|hamburger
🍟|patatine fritte|fries
🌭|hot dog|hotdog
🥪|panino tramezzino|sandwich
🌮|taco|taco
🍣|sushi|sushi
🍜|ramen brodo|ramen
🍲|zuppa pentola|stew
🥗|insalata|salad green_salad
🍦|gelato cono|icecream
🍰|torta fetta|cake shortcake
🎂|torta di compleanno|birthday cake
🍫|cioccolato|chocolate_bar
🍪|biscotto|cookie
🍩|ciambella|doughnut
☕|caffè tazza|coffee
🍵|tè|tea
🍷|vino bicchiere|wine_glass wine
🍺|birra|beer
🥂|brindisi cin cin|clinking_glasses cheers
🍾|spumante bottiglia|champagne
⚽|calcio pallone|soccer football
🏀|basket pallacanestro|basketball
🎾|tennis|tennis
🏐|pallavolo|volleyball
🚴|bicicletta ciclista|bicyclist cycling
🏆|trofeo coppa|trophy
🥇|medaglia d'oro primo|1st_place_medal gold
🎯|bersaglio centro|dart target bullseye
🎮|videogioco|video_game
🎲|dado|game_die dice
🧩|puzzle tassello|jigsaw puzzle
🎨|tavolozza arte|art palette
🎬|ciak film|clapper film
🎤|microfono cantare|microphone
🎧|cuffie musica|headphones
🎵|nota musicale|musical_note music
🎶|note musica|notes
🎸|chitarra|guitar
🎹|pianoforte tastiera|musical_keyboard piano
📚|libri studio|books
📖|libro aperto leggere|book open_book
📝|appunti memo nota|memo pencil note
✏️|matita|pencil2 pencil
🖊️|penna|pen
📌|puntina|pushpin pin
📍|segnaposto luogo|round_pushpin location
📎|graffetta allegato|paperclip attachment
✂️|forbici|scissors
📁|cartella|file_folder folder
📂|cartella aperta|open_file_folder
📄|pagina documento|page_facing_up document
📅|calendario data|date calendar
📆|calendario strappo|calendar_spiral
🗓️|agenda calendario a spirale|spiral_calendar
📊|grafico a barre|bar_chart chart
📈|grafico in crescita|chart_with_upwards_trend growth
📉|grafico in calo|chart_with_downwards_trend decline
📋|appunti lavagnetta|clipboard
🔍|lente cerca|mag search
🔒|lucchetto chiuso|lock
🔓|lucchetto aperto|unlock
🔑|chiave|key
🔔|campanella notifica|bell
📣|megafono annuncio|mega megaphone
📢|altoparlante|loudspeaker
💡|lampadina idea|bulb idea
🔧|chiave inglese|wrench
🔨|martello|hammer
⚙️|ingranaggio impostazioni|gear settings
🧪|provetta esperimento|test_tube
🔬|microscopio|microscope
🔭|telescopio|telescope
💻|computer portatile|computer laptop
🖥️|computer fisso|desktop_computer
⌨️|tastiera|keyboard
🖱️|mouse computer|computer_mouse
📱|telefono cellulare|iphone phone mobile
☎️|telefono|phone telephone
📷|macchina fotografica|camera
🎥|cinepresa|movie_camera
📺|televisione|tv
🔋|batteria|battery
🔌|spina presa|electric_plug
💾|dischetto salvare|floppy_disk save
📦|pacco scatola|package box
✉️|busta lettera|envelope email
📧|email posta|e-mail
📮|cassetta postale|postbox
💰|soldi sacco|moneybag money
💳|carta di credito|credit_card
💶|euro banconota|euro
🧾|scontrino ricevuta|receipt
🏠|casa|house home
🏢|ufficio palazzo|office building
🏫|scuola|school
🏥|ospedale|hospital
⛪|chiesa|church
🏰|castello|european_castle castle
🗽|statua della libertà|statue_of_liberty
🗼|torre|tokyo_tower tower
⛰️|montagna|mountain
🏖️|spiaggia|beach_umbrella beach
🏕️|campeggio tenda|camping
🚗|auto macchina|car red_car
🚕|taxi|taxi
🚌|autobus|bus
🚆|treno|train
🚇|metropolitana|metro
✈️|aereo volo|airplane plane
🚀|razzo lancio|rocket launch
🛳️|nave|passenger_ship ship
⛵|barca a vela|sailboat
🚲|bici|bike bicycle
🛵|motorino scooter|motor_scooter
⛽|benzina distributore|fuelpump
🚦|semaforo|vertical_traffic_light
🚧|lavori in corso cantiere|construction
🗺️|mappa|world_map map
🧭|bussola|compass
⏰|sveglia|alarm_clock
⏳|clessidra attesa|hourglass_flowing_sand
⌛|clessidra finito|hourglass
⏱️|cronometro|stopwatch
🕐|orologio ora|clock1 clock
🎉|festa coriandoli evviva|tada party celebration
🎊|palla coriandoli|confetti_ball
🎈|palloncino|balloon
🎁|regalo pacco dono|gift present
🎄|albero di natale|christmas_tree
🎃|zucca halloween|jack_o_lantern pumpkin
🏁|bandiera a scacchi traguardo|checkered_flag finish
🚩|bandierina rossa|triangular_flag_on_post red_flag
🏳️|bandiera bianca|white_flag
🇮🇹|italia bandiera italiana|it italy
🇪🇺|europa unione europea|eu european_union
✅|fatto spunta verde|white_check_mark done check
☑️|casella spuntata|ballot_box_with_check
✔️|spunta|heavy_check_mark check_mark
❌|croce no errore|x cross_mark no
❎|croce verde|negative_squared_cross_mark
➕|più aggiungi|heavy_plus_sign plus
➖|meno togli|heavy_minus_sign minus
✖️|per moltiplicare|heavy_multiplication_x
➗|diviso|heavy_division_sign
❓|domanda punto interrogativo|question
❗|attenzione punto esclamativo|exclamation heavy_exclamation_mark
‼️|doppio esclamativo|bangbang
⚠️|attenzione avviso pericolo|warning
⛔|divieto di accesso|no_entry
🚫|vietato proibito|no_entry_sign prohibited
♻️|riciclo|recycle
🔴|cerchio rosso|red_circle
🟠|cerchio arancione|orange_circle
🟡|cerchio giallo|yellow_circle
🟢|cerchio verde|green_circle
🔵|cerchio blu|large_blue_circle blue_circle
🟣|cerchio viola|purple_circle
⚫|cerchio nero|black_circle
⚪|cerchio bianco|white_circle
🟥|quadrato rosso|red_square
🟩|quadrato verde|green_square
🟦|quadrato blu|blue_square
⬆️|freccia su|arrow_up
⬇️|freccia giù|arrow_down
⬅️|freccia sinistra|arrow_left
➡️|freccia destra|arrow_right
↩️|freccia indietro ritorno|leftwards_arrow_with_hook
🔄|frecce aggiorna ricarica|arrows_counterclockwise refresh
🔁|ripeti|repeat
🆕|nuovo|new
🆗|ok|ok
🆘|aiuto sos|sos
ℹ️|informazione|information_source info
🔗|link collegamento catena|link chain
📶|segnale|signal_strength
`;

export interface EmojiEntry {
  readonly char: string;
  readonly it: readonly string[];
  readonly en: readonly string[];
}

export const EMOJI: readonly EmojiEntry[] = DATA.trim().split("\n").map((row) => {
  const [char = "", it = "", en = ""] = row.split("|");
  return { char, it: it.split(" ").filter(Boolean), en: en.split(" ").filter(Boolean) };
});
