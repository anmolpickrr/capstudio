"""English (US) <-> English (UK) spelling normalisation.

Whisper does not distinguish regional English spellings, so the chosen
variant is enforced word-by-word after transcription. Only unambiguous
spellings are mapped (e.g. "program" is left alone because it is correct in
UK English for software).
"""
from __future__ import annotations

import re

_PAIRS = """
color colour|colors colours|colored coloured|colorful colourful|coloring colouring
favor favour|favors favours|favorite favourite|favorites favourites|favored favoured
honor honour|honors honours|honored honoured|humor humour|labor labour|neighbor neighbour
neighbors neighbours|neighborhood neighbourhood|behavior behaviour|behaviors behaviours
flavor flavour|flavors flavours|harbor harbour|rumor rumour|savior saviour|vapor vapour
endeavor endeavour|armor armour|parlor parlour|odor odour|valor valour|glamor glamour
center centre|centers centres|centered centred|theater theatre|theaters theatres
meter metre|meters metres|liter litre|liters litres|fiber fibre|caliber calibre
somber sombre|luster lustre|meager meagre|saber sabre
organize organise|organized organised|organizes organises|organizing organising
organization organisation|organizations organisations|realize realise|realized realised
realizes realises|realizing realising|recognize recognise|recognized recognised
recognizes recognises|recognizing recognising|apologize apologise|apologized apologised
apologizing apologising|criticize criticise|criticized criticised|emphasize emphasise
emphasized emphasised|minimize minimise|maximize maximise|optimize optimise
optimized optimised|optimizing optimising|optimization optimisation|customize customise
customized customised|customizing customising|prioritize prioritise|summarize summarise
memorize memorise|categorize categorise|personalize personalise|personalized personalised
specialize specialise|specialized specialised|standardize standardise|visualize visualise
finalize finalise|finalized finalised|utilize utilise|analyze analyse|analyzed analysed
analyzing analysing|paralyze paralyse|catalog catalogue|catalogs catalogues|dialog dialogue
analog analogue|traveled travelled|traveling travelling|traveler traveller|travelers travellers
canceled cancelled|canceling cancelling|labeled labelled|labeling labelling|modeled modelled
modeling modelling|fueled fuelled|leveled levelled|jewelry jewellery|counselor counsellor
enrollment enrolment|fulfill fulfil|fulfillment fulfilment|skillful skilful|willful wilful
defense defence|offense offence|license licence|pretense pretence|gray grey|mom mum
aluminum aluminium|airplane aeroplane|cozy cosy|pajamas pyjamas|plow plough|mold mould
check cheque|tire tyre|tires tyres|curb kerb|aging ageing|judgment judgement
"""

US_TO_UK: dict[str, str] = {}
for pair in re.split(r"[|\n]", _PAIRS):
    pair = pair.strip()
    if pair:
        us, uk = pair.split()
        US_TO_UK[us] = uk
# Words that are too context dependent to change automatically.
for ambiguous in ("check", "tire", "tires", "curb", "mom", "license", "meter", "meters"):
    US_TO_UK.pop(ambiguous, None)
UK_TO_US = {uk: us for us, uk in US_TO_UK.items()}

_WORD = re.compile(r"^(\W*)([A-Za-z]+)(\W*)$")


def _match_case(src: str, repl: str) -> str:
    if src.isupper() and len(src) > 1:
        return repl.upper()
    if src[0].isupper():
        return repl[0].upper() + repl[1:]
    return repl


def convert_word(word: str, variant: str) -> str:
    """variant: 'en-GB' / 'en-IN' (UK spelling) or 'en-US'."""
    table = UK_TO_US if variant == "en-US" else US_TO_UK
    m = _WORD.match(word)
    if not m:
        return word
    pre, core, post = m.groups()
    repl = table.get(core.lower())
    return f"{pre}{_match_case(core, repl)}{post}" if repl else word
