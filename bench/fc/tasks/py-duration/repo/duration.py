import re


def parse_duration(text):
    hours = re.search(r'(\d+)h', text)
    minutes = re.search(r'(\d+)m', text)
    return (int(hours.group(1)) * 3600 if hours else 0) + (int(minutes.group(1)) * 60 if minutes else 0)
