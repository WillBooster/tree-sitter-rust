macro_rules! inspect {
    ($n:literal $s:literal) => { const _: &str = stringify!($n); const _: &str = $s; };
}
macro_rules! swallow { ($($tokens:tt)*) => {}; }
inspect!(123c"foo");
inspect!(123b"foo");
inspect!(123r"foo");
inspect!(1.0c"foo");
inspect!(1.5b"foo");
inspect!(1e3r"foo");
swallow!(123duration 0xff_duration 0o7duration 0b1duration 7类型 8_unit);
swallow!(1.25duration 1.25类型 1e3duration 2.5_unit 3.0f64unit);
fn main() { let _ = (1.0f64, 1e3f32, 123u128); }
swallow!(1.0 r"raw" 2.0 br"byte" 3.0 cr"c" 4.0 /* comment */r#"raw"#);
