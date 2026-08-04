"""Unit tests for safe Product Reference extraction from product-page URLs."""

from unittest.mock import MagicMock

import pytest
import requests

pytestmark = pytest.mark.unit

from app.errors import PermanentError, TransientError  # noqa: E402
from app.product_context import ProductPageExtractor  # noqa: E402


def _response(
    *,
    status_code=200,
    body=b"<html><body>Product details</body></html>",
    content_type="text/html; charset=utf-8",
    location=None,
):
    """Build the minimal requests response used by the extractor."""
    response = MagicMock()
    response.status_code = status_code
    response.headers = {"Content-Type": content_type}
    if location is not None:
        response.headers["Location"] = location
    response.iter_content.return_value = iter([body])
    return response


def _public_dns(host, port, type=None):  # noqa: A002
    """Resolve every test hostname to a public address without making DNS calls."""
    return [(2, 1, 6, "", ("93.184.216.34", port))]


def test_extract_returns_readable_page_text(monkeypatch):
    html = b"""
        <html><head><title>Widget Pro</title><style>.hidden {}</style></head>
        <body><h1>Widget Pro</h1><p>Clinically tested.</p>
        <script>ignoreMe()</script></body></html>
    """
    session = MagicMock()
    session.get.return_value = _response(body=html)
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    context = ProductPageExtractor(session=session).extract("https://example.com/widget")

    assert "Clinically tested." in context.raw_text
    assert "ignoreMe" not in context.raw_text


def test_extract_combines_product_json_ld_with_clean_main_text(monkeypatch):
    html = b"""
        <html><head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Daily Serum",
              "brand": {"@type": "Brand", "name": "Example Labs"},
              "description": "A lightweight antioxidant serum.",
              "sku": "SERUM-30",
              "image": ["https://example.com/serum.jpg"],
              "offers": {"@type": "Offer", "price": "19.00", "priceCurrency": "CAD"}
            }
          </script>
        </head><body>
          <nav>Shop Account Cart Newsletter</nav>
          <main><h1>Daily Serum</h1><p>Apply morning and evening.</p></main>
          <footer>Privacy Terms Newsletter</footer>
        </body></html>
    """
    session = MagicMock()
    session.get.return_value = _response(body=html)
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    context = ProductPageExtractor(session=session).extract("https://example.com/serum")

    assert "Name: Daily Serum" in context.raw_text
    assert "Brand: Example Labs" in context.raw_text
    assert "Description: A lightweight antioxidant serum." in context.raw_text
    assert "SKU: SERUM-30" in context.raw_text
    assert "Price: 19.00 CAD" in context.raw_text
    assert "Apply morning and evening." in context.raw_text
    assert "Shop Account Cart Newsletter" not in context.raw_text
    assert context.reference_asset_urls == ("https://example.com/serum.jpg",)


def test_extract_uses_open_graph_fallback_and_removes_template_tokens(monkeypatch):
    html = b"""
        <html><head>
          <meta property="og:title" content="Coin Wallet">
          <meta property="og:description" content="A slim wallet for cards, bills, and coins.">
          <meta property="og:image" content="/images/coin-wallet.jpg">
          <meta property="product:price:amount" content="99">
          <meta property="product:price:currency" content="CAD">
        </head><body><main>
          <h1>Coin Wallet</h1><p>Premium leather construction.</p>
          <p>#[sku.dimensions.product_dim_h_cm] cm</p>
        </main></body></html>
    """
    session = MagicMock()
    session.get.return_value = _response(body=html)
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    context = ProductPageExtractor(session=session).extract("https://example.com/wallet")

    assert "Title: Coin Wallet" in context.raw_text
    assert "Description: A slim wallet for cards, bills, and coins." in context.raw_text
    assert "Price: 99 CAD" in context.raw_text
    assert "Premium leather construction." in context.raw_text
    assert "#[sku." not in context.raw_text
    assert context.reference_asset_urls == ("https://example.com/images/coin-wallet.jpg",)


def test_extract_selects_primary_product_and_excludes_related_products(monkeypatch):
    html = b"""
        <html><head>
          <meta property="og:title" content="Oatly Oat Drink | Products">
          <script type="application/ld+json">
            [
              {
                "@type": "Product",
                "name": "Oat Drink",
                "sku": "63135",
                "url": "https://example.com/products/oat-drink/oat-drink-1l"
              },
              {
                "@type": "Product",
                "name": "Oat Drink Barista Organic",
                "url": "https://example.com/products/oat-drink/barista-organic-1l"
              },
              {
                "@type": "Product",
                "name": "Oat Drink Chocolate",
                "url": "https://example.com/products/oat-drink/chocolate-1l"
              }
            ]
          </script>
        </head><body><main>
          <h1>Oat Drink</h1><p>The original liquid oats.</p>
        </main></body></html>
    """
    session = MagicMock()
    session.get.return_value = _response(body=html)
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    context = ProductPageExtractor(session=session).extract(
        "https://example.com/en-ca/products/oat-drink/oat-drink-1l"
    )

    assert "Name: Oat Drink" in context.raw_text
    assert "SKU: 63135" in context.raw_text
    assert "Oat Drink Barista Organic" not in context.raw_text
    assert "Oat Drink Chocolate" not in context.raw_text


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/product",
        "https://user:password@example.com/product",
        "http://localhost/product",
        "http://127.0.0.1/product",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/product",
    ],
)
def test_extract_rejects_unsafe_urls(monkeypatch, url):
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    with pytest.raises(PermanentError):
        ProductPageExtractor(session=MagicMock()).extract(url)


def test_extract_rejects_hostname_resolving_to_private_network(monkeypatch):
    def private_dns(host, port, type=None):  # noqa: A002
        return [(2, 1, 6, "", ("10.0.0.7", port))]

    monkeypatch.setattr("app.product_context.socket.getaddrinfo", private_dns)

    with pytest.raises(PermanentError, match="public network"):
        ProductPageExtractor(session=MagicMock()).extract("https://example.com/product")


def test_extract_validates_redirect_destination(monkeypatch):
    session = MagicMock()
    session.get.return_value = _response(
        status_code=302,
        location="http://127.0.0.1/private",
    )
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    with pytest.raises(PermanentError):
        ProductPageExtractor(session=session).extract("https://example.com/product")


def test_extract_rejects_non_html_content(monkeypatch):
    session = MagicMock()
    session.get.return_value = _response(content_type="application/pdf")
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    with pytest.raises(PermanentError, match="HTML"):
        ProductPageExtractor(session=session).extract("https://example.com/product")


def test_extract_rejects_oversized_page(monkeypatch):
    session = MagicMock()
    response = _response()
    response.iter_content.return_value = iter([b"a" * 8, b"b" * 8])
    session.get.return_value = response
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    with pytest.raises(PermanentError, match="size limit"):
        ProductPageExtractor(session=session, max_response_bytes=10).extract(
            "https://example.com/product"
        )


def test_extract_maps_network_timeout_to_transient_error(monkeypatch):
    session = MagicMock()
    session.get.side_effect = requests.Timeout("slow")
    monkeypatch.setattr("app.product_context.socket.getaddrinfo", _public_dns)

    with pytest.raises(TransientError):
        ProductPageExtractor(session=session).extract("https://example.com/product")
