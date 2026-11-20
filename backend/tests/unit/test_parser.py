"""Article text extraction: page code (a paywall as JSON) is not an article."""

from pathlib import Path

import pytest

from backend.app.ingestion import ArticleParseError
from backend.app.ingestion.parser import (
    clean_link,
    extract_links,
    looks_like_code,
    page_data_text,
    parse_article_html,
    site_of,
)

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


# Page furniture and page data (NU.nl, 2026-11-19): pages in NU.nl's shape, with own text
FIXTURES = Path("backend/tests/fixtures/html")


def test_a_question_block_inside_the_article_is_not_the_article():
    """With "Stel een vraag" in the article, the stored text was that block (265 characters)."""
    html = (FIXTURES / "nunl_question_widget.html").read_text(encoding="utf-8")

    text = parse_article_html(html, url="https://www.nu.nl/binnenland/1/watertoren.html").text

    assert text.startswith("De gemeente Waterdorp wil de oude watertoren")
    assert "ruim drie miljoen euro" in text
    assert "Stel een vraag" not in text and "in te loggen" not in text


def test_text_from_the_page_data_gets_its_line_breaks_back():
    """The extraction takes this text from the page's JSON-LD without decoding it."""
    html = (FIXTURES / "nunl_page_data.html").read_text(encoding="utf-8")

    text = parse_article_html(html, url="https://www.nu.nl/binnenland/1/watertoren.html").text

    assert "\\n" not in text
    paragraphs = text.split("\n")
    assert len(paragraphs) == 6
    assert paragraphs[0] == "Watertoren van Waterdorp blijft staan"
    assert paragraphs[1].startswith("De gemeente Waterdorp wil de oude watertoren")
    assert paragraphs[1].endswith("de komende jaren veel geld gaat kosten.")
    assert paragraphs[5].startswith("Wethouder De Wit is tegen het besluit.")


def test_a_text_with_line_breaks_keeps_a_written_out_backslash():
    """Only a text without any line break is page data; a backslash-n in a normal text stays."""
    from backend.app.ingestion.parser import _line_breaks

    assert _line_breaks("De map C:\\nieuws staat op de schijf.\nTweede alinea.") == (
        "De map C:\\nieuws staat op de schijf.\nTweede alinea."
    )
    written_out = "Kop\\nEerste alinea.\\nTweede alinea."
    assert _line_breaks(written_out) == "Kop\nEerste alinea.\nTweede alinea."


def test_a_source_with_page_data_gets_the_text_the_page_gives():
    """NU.nl: the article stands in the page's data; readers' comments under it are no article."""
    html = (FIXTURES / "nunl_comments.html").read_text(encoding="utf-8")

    url = "https://www.nu.nl/binnenland/1/watertoren.html"
    text = parse_article_html(html, url=url, page_data=True).text

    paragraphs = text.split("\n")
    assert paragraphs[0] == "Watertoren van Waterdorp blijft staan"
    assert paragraphs[1].startswith("De gemeente Waterdorp wil de oude watertoren")
    assert paragraphs[3].endswith('"Dat geld hebben we niet", zegt ze.')
    assert len(paragraphs) == 4
    assert "Uitgelichte reacties" not in text and "Mijn opa" not in text


def test_page_data_is_only_read_for_a_source_that_asks_for_it():
    html = (FIXTURES / "nunl_comments.html").read_text(encoding="utf-8")

    assert page_data_text(html).startswith("Watertoren van Waterdorp blijft staan\nDe gemeente")
    # Another source keeps the extraction, whatever that page's data says
    assert "Uitgelichte reacties" in parse_article_html(html, url="https://example.com/1").text


def test_a_teaser_or_broken_page_data_is_no_article():
    teaser = '<script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Kort."}</script>'
    broken = '<script type="application/ld+json">{"articleBody": "x" * </script>'
    html = Path("backend/tests/fixtures/html/article_simple.html").read_text(encoding="utf-8")

    assert page_data_text(teaser) is None
    assert page_data_text(broken) is None
    with_teaser = html.replace("</head>", teaser + "</head>")
    assert parse_article_html(with_teaser, url="https://example.com/1", page_data=True).text == (
        parse_article_html(html, url="https://example.com/1").text
    )
