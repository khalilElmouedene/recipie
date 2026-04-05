"""Shared URL safety checks for server-side HTTP (SSRF mitigation)."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

# Block link-local (includes IPv4 metadata 169.254.x.x)
_METADATA_HINTS = frozenset({"metadata.google.internal", "metadata"})


def _ip_unsafe(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if addr.is_loopback or addr.is_link_local or addr.is_private:
        return True
    if addr.is_reserved or addr.is_multicast:
        return True
    if isinstance(addr, ipaddress.IPv4Address):
        # AWS/cloud metadata (often 169.254.169.254)
        if addr in ipaddress.ip_network("169.254.0.0/16"):
            return True
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped:
            return _ip_unsafe(addr.ipv4_mapped)
    return False


def is_safe_url_for_server_fetch(url: str) -> bool:
    """
    Return True only if URL uses http(s), has a host, and all resolved addresses
    are public (no loopback, private, link-local, reserved, or metadata ranges).
    Checks both IPv4 and IPv6 via getaddrinfo.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").strip().lower()
    if not host or host in _METADATA_HINTS:
        return False

    # Reject credentials in URL (odd but can confuse parsers)
    if parsed.username is not None or parsed.password is not None:
        return False

    # Literal IP in URL
    try:
        ip = ipaddress.ip_address(host)
        return not _ip_unsafe(ip)
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError:
        return False
    if not infos:
        return False
    for _fam, _type, _proto, _canon, sockaddr in infos:
        if not sockaddr:
            continue
        raw = sockaddr[0]
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            return False
        if _ip_unsafe(ip):
            return False
    return True
