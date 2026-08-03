# EAST model artifact

The worker uses the frozen EAST text-region detector graph from the
`oyyd/frozen_east_text_detection.pb` repository.

## Pinned identity

- Repository: `https://github.com/oyyd/frozen_east_text_detection.pb`
- Artifact commit: `71415464412c55bb1d135fcdeda498e29a67effa`
- Artifact file: `frozen_east_text_detection.pb`
- SHA-256:
  `9b486f3c3eee77b4c8cc91a83892c37026cca7d29b79bf3b93772ccd2db58454`

## Packaging and runtime policy

The worker Dockerfile downloads the graph from the immutable artifact commit
during image construction and verifies its SHA-256 before completing the model
layer. The graph is baked into the image at:

```text
/app/assets/models/frozen_east_text_detection.pb
```

The running worker never downloads this model. The OCR-local EAST loader
verifies the same checksum before OpenCV reads the graph and reports the text
cascade as unavailable when the artifact is missing, unreadable, corrupt, or
does not match the pinned identity.
