import re


def parse_duration(text):
    units = {'h': 3600, 'm': 60, 's': 1}
    return sum(int(n) * units[u] for n, u in re.findall(r'(\d+)([hms])', text))
