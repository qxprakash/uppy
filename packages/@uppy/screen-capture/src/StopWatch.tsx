import { h, Component } from 'preact'
import type { I18n } from '@uppy/utils/lib/Translator'

interface StopWatchProps {
  recording: boolean
  i18n: I18n
}

interface StopWatchState {
  elapsedTime: number
}

function fmtMSS(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`
}

class StopWatch extends Component<StopWatchProps, StopWatchState> {
  private wrapperStyle = {
    width: '100%',
    height: '100%',
    display: 'flex',
  } as const

  private overlayStyle = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    background: 'black',
    opacity: 0.7,
  } as const

  private infoContainerStyle = {
    marginLeft: 'auto',
    marginRight: 'auto',
    marginTop: 'auto',
    marginBottom: 'auto',
    zIndex: 1,
    color: 'white',
  } as const

  private infotextStyle = {
    marginLeft: 'auto',
    marginRight: 'auto',
    marginBottom: '1rem',
    fontSize: '1.5rem',
  } as const

  private timeStyle = {
    display: 'block',
    fontWeight: 'bold',
    marginLeft: 'auto',
    marginRight: 'auto',
    fontSize: '3rem',
    fontFamily: 'Courier New',
  } as const

  private timerRunning: boolean = false

  private timer?: ReturnType<typeof setTimeout>

  constructor(props: StopWatchProps) {
    super(props)
    this.state = { elapsedTime: 0 }
  }

  startTimer(): void {
    this.timerTick()
    this.timerRunning = true
  }

  resetTimer(): void {
    clearTimeout(this.timer)
    this.setState({ elapsedTime: 0 })
    this.timerRunning = false
  }

  timerTick(): void {
    this.timer = setTimeout(() => {
      this.setState((state) => ({
        elapsedTime: state.elapsedTime + 1,
      }))
      this.timerTick()
    }, 1000)
  }

  render(): preact.ComponentChild {
    const { recording, i18n } = this.props
    const { elapsedTime } = this.state

    const minAndSec = fmtMSS(elapsedTime)

    if (recording && !this.timerRunning) {
      this.startTimer()
    }

    if (!recording && this.timerRunning) {
      this.resetTimer()
    }

    if (recording) {
      return (
        <div style={this.wrapperStyle}>
          <div style={this.overlayStyle} />
          <div style={this.infoContainerStyle}>
            <div style={this.infotextStyle}>{i18n('recording')}</div>
            <div style={this.timeStyle}>{minAndSec}</div>
          </div>
        </div>
      )
    }
    return null
  }
}

export default StopWatch
