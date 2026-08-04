"""Safely turn a public product-page URL into clean Product Context."""

from dataclasses import dataclass
from html.parser import HTMLParser
import ipaddress
import json
import socket
from urllib.parse import urljoin, urlsplit

import requests
from trafilatura import extract

from app.errors import PermanentError, TransientError


@dataclass(frozen=True)
class ExtractedProductContext:
    """Product Reference values ready for the product_context table."""

    raw_text: str
    reference_asset_urls: tuple[str, ...]


class _ProductJsonLdParser(HTMLParser):
    """Collect Schema.org Product objects embedded as JSON-LD scripts."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._collecting = False
        self._parts: list[str] = []
        self.documents: list[object] = []
        self.metadata: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs) -> None:
        """Begin collecting only JSON-LD script bodies."""
        attributes = {name.lower(): value for name, value in attrs if value is not None}
        if tag.lower() == "meta":
            key = attributes.get("property") or attributes.get("name")
            content = attributes.get("content")
            if key and content:
                self.metadata.setdefault(key.lower(), content.strip())
        if tag.lower() == "script" and attributes.get("type", "").lower() == "application/ld+json":
            self._collecting = True
            self._parts = []

    def handle_endtag(self, tag: str) -> None:
        """Decode a complete JSON-LD script without failing the whole page."""
        if tag.lower() != "script" or not self._collecting:
            return
        self._collecting = False
        try:
            self.documents.append(json.loads("".join(self._parts)))
        except json.JSONDecodeError:
            # Retail pages sometimes include malformed analytics JSON-LD. A bad
            # block should not discard clean main content or other valid blocks.
            pass

    def handle_data(self, data: str) -> None:
        """Retain the current JSON-LD script body for decoding at its end tag."""
        if self._collecting:
            self._parts.append(data)


class ProductPageExtractor:
    """Fetch bounded public HTML and extract readable Product Reference text."""

    _REDIRECT_STATUSES = {301, 302, 303, 307, 308}

    def __init__(
        self,
        session: requests.Session | None = None,
        *,
        timeout_seconds: float = 10,
        max_redirects: int = 3,
        max_response_bytes: int = 2_000_000,
    ) -> None:
        self.session = session or requests.Session()
        self.timeout_seconds = timeout_seconds
        self.max_redirects = max_redirects
        self.max_response_bytes = max_response_bytes

    def extract(self, url: str) -> ExtractedProductContext:
        """Fetch a product page and return structured facts plus clean main text."""
        current_url = url.strip()

        # Redirects are followed manually so every destination passes the same
        # public-network checks before the worker makes another request.
        for redirect_count in range(self.max_redirects + 1):
            self._validate_public_url(current_url)
            response = self._get(current_url)

            if response.status_code in self._REDIRECT_STATUSES:
                if redirect_count == self.max_redirects:
                    raise PermanentError("Product page exceeded redirect limit")
                location = response.headers.get("Location")
                if not location:
                    raise PermanentError("Product page redirect has no destination")
                current_url = urljoin(current_url, location)
                continue

            if response.status_code in (408, 429) or response.status_code >= 500:
                raise TransientError(
                    f"Product page temporarily unavailable ({response.status_code})"
                )
            if response.status_code >= 400:
                raise PermanentError(
                    f"Product page request failed ({response.status_code})"
                )

            content_type = response.headers.get("Content-Type", "").lower()
            if "text/html" not in content_type:
                raise PermanentError("Product page did not return HTML")

            body = self._read_bounded_body(response)
            encoding = response.encoding if isinstance(response.encoding, str) else "utf-8"
            html = body.decode(encoding, errors="replace")
            context = self._extract_context(html, current_url)
            if not context.raw_text:
                raise PermanentError("Product page contained no readable text")
            return context

        raise PermanentError("Product page redirect handling failed")

    @staticmethod
    def _extract_context(html: str, page_url: str) -> ExtractedProductContext:
        """Combine Schema.org product facts with Trafilatura's boilerplate removal."""
        parser = _ProductJsonLdParser()
        parser.feed(html)
        discovered_product_nodes = [
            node
            for document in parser.documents
            for node in ProductPageExtractor._walk_json(document)
            if ProductPageExtractor._is_product_node(node)
        ]
        product_nodes = ProductPageExtractor._select_primary_product_nodes(
            discovered_product_nodes,
            page_url,
            parser.metadata,
        )

        structured_lines: list[str] = []
        asset_urls: list[str] = []
        for node in product_nodes:
            # Product pages may expose variants as multiple nodes. Preserve each
            # node's distinct facts while deduplicating the final lines and URLs.
            structured_lines.extend(ProductPageExtractor._product_lines(node))
            asset_urls.extend(ProductPageExtractor._product_images(node, page_url))

        extracted_text = extract(
            html,
            url=page_url,
            output_format="txt",
            include_comments=False,
            include_tables=True,
            deduplicate=True,
            favor_precision=True,
        ) or ""
        main_text = "\n".join(
            " ".join(line.split())
            for line in extracted_text.splitlines()
            # Unresolved storefront-template tokens are implementation noise,
            # not Product Reference evidence for downstream evaluators.
            if line.strip()
            and "#[" not in line
            and "{{" not in line
            and "{%" not in line
        ).strip()

        metadata_matches = ProductPageExtractor._metadata_matches_content(
            parser.metadata,
            main_text,
            page_url,
        )
        if not product_nodes and metadata_matches:
            structured_lines.extend(ProductPageExtractor._metadata_lines(parser.metadata))
            metadata_image = parser.metadata.get("og:image")
            if metadata_image:
                absolute_image = urljoin(page_url, metadata_image)
                if urlsplit(absolute_image).scheme in {"http", "https"}:
                    asset_urls.append(absolute_image)

        sections: list[str] = []
        unique_lines = list(dict.fromkeys(structured_lines))
        if unique_lines:
            sections.append("Structured product data:\n" + "\n".join(unique_lines))
        if main_text.strip():
            sections.append("Page content:\n" + main_text.strip())

        return ExtractedProductContext(
            raw_text="\n\n".join(sections),
            reference_asset_urls=tuple(dict.fromkeys(asset_urls)),
        )

    @staticmethod
    def _select_primary_product_nodes(
        nodes: list[dict],
        page_url: str,
        metadata: dict[str, str],
    ) -> list[dict]:
        """Select the page's primary Product instead of recommendation nodes."""
        if len(nodes) <= 1:
            return nodes

        page_path = ProductPageExtractor._normalized_product_path(page_url)
        title = metadata.get("og:title", "").split("|", 1)[0].strip().lower()
        ranked: list[tuple[int, int, dict]] = []

        for index, node in enumerate(nodes):
            score = 0
            for identity_url in ProductPageExtractor._product_identity_urls(node):
                candidate_path = ProductPageExtractor._normalized_product_path(identity_url)
                if candidate_path and candidate_path == page_path:
                    score = max(score, 100)

            name = str(node.get("name", "")).strip().lower()
            if name and name in title:
                score = max(score, 20)

            # Earlier top-level nodes win a tie because storefronts commonly
            # serialize the page product before recommendation carousels.
            ranked.append((score, -index, node))

        best = max(ranked, key=lambda item: (item[0], item[1]))
        return [best[2]]

    @staticmethod
    def _product_identity_urls(node: dict) -> list[str]:
        """Collect URL-like identity fields used by common JSON-LD generators."""
        urls: list[str] = []
        for field in ("url", "@id", "mainEntityOfPage"):
            value = node.get(field)
            if isinstance(value, dict):
                value = value.get("url") or value.get("@id")
            if isinstance(value, str):
                urls.append(value)
        return urls

    @staticmethod
    def _normalized_product_path(url: str) -> str:
        """Normalize paths while ignoring a leading locale such as /en-ca/."""
        path_parts = [part for part in urlsplit(url).path.lower().split("/") if part]
        if (
            path_parts
            and len(path_parts[0]) == 5
            and path_parts[0][2] == "-"
            and path_parts[0][:2].isalpha()
            and path_parts[0][3:].isalpha()
        ):
            path_parts = path_parts[1:]
        return "/" + "/".join(path_parts)

    @staticmethod
    def _metadata_lines(metadata: dict[str, str]) -> list[str]:
        """Recover stable product facts when a storefront omits Product JSON-LD."""
        title = metadata.get("og:title")
        description = metadata.get("og:description") or metadata.get("description")
        price = metadata.get("product:price:amount")
        currency = metadata.get("product:price:currency")

        lines: list[str] = []
        if title:
            lines.append(f"Title: {' '.join(title.split())}")
        if description:
            lines.append(f"Description: {' '.join(description.split())}")
        if price:
            lines.append(f"Price: {price}{f' {currency}' if currency else ''}")
        return lines

    @staticmethod
    def _metadata_matches_content(
        metadata: dict[str, str],
        main_text: str,
        page_url: str,
    ) -> bool:
        """Reject generic site metadata that does not describe the extracted page."""
        title = metadata.get("og:title", "")
        # Storefront titles commonly append brand and SEO copy after a pipe. The
        # leading segment is the most stable product-name candidate.
        candidate = title.split("|", 1)[0].strip().lower()
        page_slug = urlsplit(page_url).path.rstrip("/").split("/")[-1]
        normalized_slug = page_slug.replace("-", " ").replace("_", " ").lower()
        return bool(
            candidate
            and (candidate in main_text.lower() or candidate in normalized_slug)
        )

    @staticmethod
    def _walk_json(value):
        """Yield every mapping in a JSON-LD graph, including nested variants."""
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from ProductPageExtractor._walk_json(child)
        elif isinstance(value, list):
            for child in value:
                yield from ProductPageExtractor._walk_json(child)

    @staticmethod
    def _is_product_node(node: dict) -> bool:
        """Recognize Product and its common Schema.org specializations."""
        node_types = node.get("@type", [])
        if isinstance(node_types, str):
            node_types = [node_types]
        product_types = {
            "Product",
            "ProductGroup",
            "IndividualProduct",
            "ProductModel",
            "DietarySupplement",
            "Drug",
        }
        return any(str(node_type).rstrip("/").split("/")[-1] in product_types for node_type in node_types)

    @staticmethod
    def _product_lines(node: dict) -> list[str]:
        """Render stable, evaluator-friendly facts from a Product JSON-LD node."""
        lines: list[str] = []
        fields = (
            ("Name", node.get("name")),
            ("Brand", ProductPageExtractor._name_value(node.get("brand"))),
            ("Description", node.get("description")),
            ("SKU", node.get("sku")),
            ("MPN", node.get("mpn")),
            ("Category", node.get("category")),
            ("Material", node.get("material")),
            ("Color", node.get("color")),
            ("Size", node.get("size")),
        )
        for label, value in fields:
            if isinstance(value, (str, int, float)) and str(value).strip():
                lines.append(f"{label}: {' '.join(str(value).split())}")

        offers = node.get("offers", [])
        if isinstance(offers, dict):
            offers = [offers]
        if isinstance(offers, list):
            for offer in offers:
                if not isinstance(offer, dict):
                    continue
                price = offer.get("price") or offer.get("lowPrice")
                currency = offer.get("priceCurrency")
                if price is not None:
                    lines.append(f"Price: {price}{f' {currency}' if currency else ''}")
        return lines

    @staticmethod
    def _name_value(value):
        """Read a Schema.org named object or an already-scalar value."""
        return value.get("name") if isinstance(value, dict) else value

    @staticmethod
    def _product_images(node: dict, page_url: str) -> list[str]:
        """Normalize Product image values into absolute HTTP(S) asset URLs."""
        images = node.get("image", [])
        if not isinstance(images, list):
            images = [images]

        urls: list[str] = []
        for image in images:
            if isinstance(image, dict):
                image = image.get("contentUrl") or image.get("url")
            if not isinstance(image, str):
                continue
            absolute_url = urljoin(page_url, image)
            if urlsplit(absolute_url).scheme in {"http", "https"}:
                urls.append(absolute_url)
        return urls

    def _get(self, url: str):
        """Map transport failures into the worker's retry vocabulary."""
        try:
            return self.session.get(
                url,
                allow_redirects=False,
                stream=True,
                timeout=self.timeout_seconds,
                headers={"User-Agent": "AdReadyAI-ProductContext/1.0"},
            )
        except (requests.Timeout, requests.ConnectionError) as error:
            raise TransientError(f"Product page connection failed: {error}") from error
        except requests.RequestException as error:
            raise PermanentError(f"Product page request failed: {error}") from error

    def _read_bounded_body(self, response) -> bytes:
        """Read streaming response chunks without allowing unbounded memory use."""
        body = bytearray()
        for chunk in response.iter_content(chunk_size=64 * 1024):
            # A streaming limit protects the worker even when Content-Length is
            # absent or dishonest, which is common on dynamically rendered pages.
            body.extend(chunk)
            if len(body) > self.max_response_bytes:
                raise PermanentError("Product page exceeded size limit")
        return bytes(body)

    @staticmethod
    def _validate_public_url(url: str) -> None:
        """Reject malformed URLs and hosts that resolve outside public networks."""
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise PermanentError("Product URL must use HTTP or HTTPS")
        if parsed.username is not None or parsed.password is not None:
            raise PermanentError("Product URL must not contain credentials")
        if parsed.hostname.lower() == "localhost":
            raise PermanentError("Product URL must use a public network")

        # Literal addresses do not need DNS and must be classified directly;
        # otherwise a resolver abstraction could accidentally obscure loopback.
        try:
            literal_ip = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            literal_ip = None
        if literal_ip is not None:
            if not literal_ip.is_global:
                raise PermanentError("Product URL must use a public network")
            return

        try:
            addresses = socket.getaddrinfo(
                parsed.hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        except socket.gaierror as error:
            raise TransientError(f"Product URL hostname could not be resolved: {error}") from error

        # Every resolved address must be globally routable. Rejecting the whole
        # hostname prevents a mixed public/private DNS answer from bypassing SSRF checks.
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if not ip.is_global:
                raise PermanentError("Product URL must use a public network")
