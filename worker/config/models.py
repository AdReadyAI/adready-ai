import os
from functools import lru_cache

import cv2
import open_clip

from config.settings import (
    EAST_MODEL_PATH,
    MOBILECLIP_MODEL_NAME,
    MOBILECLIP_PRETRAINED_TAG,
    logger,
)


@lru_cache(maxsize=1)
def get_east():
    if not os.path.exists(EAST_MODEL_PATH):
        raise FileNotFoundError(f"EAST model not found: {EAST_MODEL_PATH}")
    logger.info("Loading EAST model from %s", EAST_MODEL_PATH)
    return cv2.dnn.readNet(EAST_MODEL_PATH)


@lru_cache(maxsize=1)
def get_mobileclip():
    logger.info(
        "Loading %s (pretrained=%s)", MOBILECLIP_MODEL_NAME, MOBILECLIP_PRETRAINED_TAG
    )
    model, _, preprocess = open_clip.create_model_and_transforms(
        MOBILECLIP_MODEL_NAME,
        pretrained=MOBILECLIP_PRETRAINED_TAG,
        device='cpu',
        image_mean=(0, 0, 0),
        image_std=(1, 1, 1),
    )
    model.eval()
    return model, preprocess