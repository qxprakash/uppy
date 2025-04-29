import { h, Component, type ComponentChild } from 'preact'
import type { Body, Meta } from '@uppy/core'
import RecordButton from './RecordButton.jsx'
import SubmitButton from './SubmitButton.jsx'
import ScreenshotButton from './ScreenshotButton.jsx'
import StopWatch from './StopWatch.jsx'
import StreamStatus from './StreamStatus.jsx'

import ScreenCapture, { type ScreenCaptureState } from './ScreenCapture.jsx'

type RecorderScreenProps<M extends Meta, B extends Body> = {
  onStartRecording: ScreenCapture<M, B>['startRecording']
  onStopRecording: ScreenCapture<M, B>['stopRecording']
  onStop: ScreenCapture<M, B>['stop']
  onSubmit: ScreenCapture<M, B>['submit']
  onScreenshot: ScreenCapture<M, B>['captureScreenshot']
  i18n: ScreenCapture<M, B>['i18n']
  stream: ScreenCapture<M, B>['videoStream']
  enableScreenshots: boolean
} & ScreenCaptureState

class RecorderScreen<M extends Meta, B extends Body> extends Component<
  RecorderScreenProps<M, B>
> {
  videoElement: HTMLVideoElement | null = null

  componentWillUnmount(): void {
    const { onStop } = this.props
    onStop()
  }

  updateVideoElement = (element: HTMLVideoElement | null): void => {
    if (!element) return

    const { recording, recordedVideo, stream } = this.props
    this.videoElement = element

    const videoElement = element as HTMLVideoElement & {
      srcObject: MediaStream | null
    }
    if (recording || (!recordedVideo && !recording)) {
      videoElement.srcObject = stream
    } else {
      videoElement.srcObject = null
    }
  }

  render(): ComponentChild {
    const {
      recording,
      recordedVideo,
      onScreenshot,
      onStartRecording,
      onStopRecording,
      onSubmit,
      i18n,
      enableScreenshots,
      streamActive,
    } = this.props

    return (
      <div className="uppy uppy-ScreenCapture-container">
        <div className="uppy-ScreenCapture-videoContainer">
          <StreamStatus
            streamActive={streamActive}
            streamPassive={!streamActive}
            i18n={i18n}
          />
          <video
            className="uppy-ScreenCapture-video"
            ref={this.updateVideoElement}
            playsInline
            muted={recording || (!recordedVideo && !recording)}
            autoPlay={recording || (!recordedVideo && !recording)}
            controls={(recordedVideo && !recording) || undefined}
            src={recordedVideo && !recording ? recordedVideo : undefined}
          >
            <track kind="captions" />
          </video>
          <div className="uppy-ScreenCapture-stopwatch">
            <StopWatch recording={recording} i18n={i18n} />
          </div>
        </div>

        <div className="uppy-ScreenCapture-buttonContainer">
          {enableScreenshots && (
            <ScreenshotButton onScreenshot={onScreenshot} i18n={i18n} />
          )}{' '}
          <RecordButton
            recording={recording}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            i18n={i18n}
          />
          <SubmitButton
            recording={recording}
            recordedVideo={recordedVideo}
            onSubmit={onSubmit}
            i18n={i18n}
          />
        </div>
      </div>
    )
  }
}

export default RecorderScreen
