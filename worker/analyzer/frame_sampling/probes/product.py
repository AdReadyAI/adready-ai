from analyzer.frame_sampling.base import ProbeSetup, Stage, register_probe
from analyzer.frame_sampling.probes.reference_match import ReferenceMatchProbe


@register_probe(Stage.PRODUCT)
class ProductProbe(ReferenceMatchProbe):

    name = "product"

    def _reference_paths(self, setup: ProbeSetup) -> list[str]:
        return setup.product_image_paths
