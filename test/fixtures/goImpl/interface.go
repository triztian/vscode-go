package goImpl

type Interface interface {
	Error() error
	Struct() struct {
		X string
		Y int
	}
}
