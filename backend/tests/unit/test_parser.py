"""Article text extraction: page code (a paywall as JSON) is not an article."""

from pathlib import Path

import pytest

from backend.app.ingestion import ArticleParseError
from backend.app.ingestion.parser import clean_link, extract_links, looks_like_code, parse_article_html, site_of

PAYWALL_JSON = (
    '","textAlignment":"center","textColor":{"light":"#000000","dark":"#000000"},'
    '"linkColor":{"light":"#27509a","dark":"#27509a"},"font":"default","size":"sm",'
    '"showTrackingData":"{\\"eventaction\\":\\"show\\",\\"eventlabel\\":\\"paywall\\"}"'
)


def test_paywall_json_looks_like_code():
    assert looks_like_code(PAYWALL_JSON)


def test_article_with_quotes_is_not_code():
    text = (
        'De politie heeft vanavond in Hoogeveen zes mensen aangehouden, meldt de NOS. '
        '"We grijpen hard in", zegt de burgemeester. Het is al dagen onrustig in de wijk.'
    )
    assert not looks_like_code(text)


def test_empty_text_is_not_code():
    assert not looks_like_code("")


def test_page_code_is_a_parse_failure():
    html = f"<html><body><article><p>{PAYWALL_JSON * 20}</p></article></body></html>"
    with pytest.raises(ArticleParseError):
        parse_article_html(html, url="https://example.com/premium")


def test_normal_article_still_parses():
    html = Path("backend/tests/fixtures/html/article_simple.html").read_text(encoding="utf-8")
    assert parse_article_html(html, url="https://example.com/artikel/1").text


# Links in the article text (OSINT): the pages an article rests on
LINKED_ARTICLE = """<html><body>
<nav><a href="/home">Home</a><a href="https://www.facebook.com/ad.nl">Volg ons</a></nav>
<article><h1>Kabinet stuurt brief</h1>
<p>Het kabinet meldt in <a href="https://www.rijksoverheid.nl/documenten/kamerstukken/2026/11/15/brief?utm_source=x&amp;id=7#top">een
brief aan de Kamer</a> dat de maatregel langer duurt dan gepland, omdat de uitvoering vertraging heeft opgelopen.</p>
<p>Volgens <a href="/binnenland/eerder~a2/">eerder nieuws</a> en het <a href="https://www.cbs.nl/nl-nl/nieuws/2026/46/cijfers">CBS</a>
klopt dat. <a href="https://www.facebook.com/sharer/sharer.php?u=x">Deel</a> Het
<a href="https://www.cbs.nl/nl-nl/nieuws/2026/46/cijfers?utm_campaign=y">CBS-bericht</a> noemt meer cijfers over de uitvoering.</p>
</article>
<footer><a href="https://www.dpgmedia.nl">DPG Media</a></footer>
</body></html>"""


def test_links_in_the_text_to_other_sites():
    parsed = parse_article_html(LINKED_ARTICLE, url="https://www.ad.nl/binnenland/brief~a1/")
    assert parsed.links == [
        "https://www.rijksoverheid.nl/documenten/kamerstukken/2026/11/15/brief?id=7",
        "https://www.cbs.nl/nl-nl/nieuws/2026/46/cijfers",
    ]


def test_extract_links_leaves_out_own_site_menu_and_sharing():
    links = extract_links(LINKED_ARTICLE, url="https://www.ad.nl/binnenland/brief~a1/")
    assert not any("ad.nl" in link or "facebook" in link or "dpgmedia" in link for link in links)


def test_site_of_country_second_level():
    assert site_of("www.bbc.co.uk") == "bbc.co.uk"
    assert site_of("nos.nl") == "nos.nl"
    assert site_of("www.nu.nl") == "nu.nl"


def test_clean_link_only_web_pages():
    assert clean_link("mailto:redactie@nos.nl") is None
    assert clean_link("javascript:void(0)") is None
    assert clean_link("https://Example.com/a?fbclid=1&q=2#x") == "https://example.com/a?q=2"


def test_clean_link_one_post_on_x():
    assert clean_link("https://twitter.com/PvanHouwelingen/status/21?s=20") == "https://x.com/PvanHouwelingen/status/21"


def test_follow_us_links_are_no_source():
    html = LINKED_ARTICLE.replace(
        "</article>",
        '<p>Volg ons op <a href="https://news.google.com/publications/CAAq?hl=nl">Google Nieuws</a> en ons '
        '<a href="https://whatsapp.com/channel/0029Vb">WhatsApp-kanaal</a> voor meer nieuws over de uitvoering.'
        ' <a href="https://www.google.com/preferences/source?q=rtl.nl">Voeg RTL toe in Google</a></p></article>',
    )
    assert not any("google" in link or "whatsapp" in link for link in extract_links(html, url="https://www.ad.nl/a~a1/"))
